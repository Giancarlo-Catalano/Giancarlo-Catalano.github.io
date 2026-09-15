const App = {
    Data: {
        problem: null,
        pref: [],
        proxies: [],
        bestSol: null,
        bestFit: -Infinity,
        uniqueRotas: new Map()
    },
    Linkage: {
        rawMatrix: null,
        visualMatrix: null,
        orderMap: []
    },
    Miner: {
        results: [],
        displayedItems: [], // FIX: Source of truth for the currently rendered UI cards
        activeMetrics: [],
        names: {
            'mean_fitness': 'Mean Fitness', 'mwu': 'MWU P-Val', 'mwu_thresh': 'MWU (Thresh)',
            'weighted_var': 'Weighted Var', 'atomicity': 'Atomicity', 'a_plus_i': 'Atomicity + Ind',
            'star_count': 'Star-count', 'inverse_star_count': 'Inverse Stars', 'independence': 'Dependence',
            'robustness': 'Robustness', 'sample_count': 'Sample Count', 'inverse_sample_count': 'Inv Samples'
        },
        evaluators: {
            'mean_fitness': fm => fm.length > 0 ? obj_mean_fitness(fm) : Infinity,
            'mwu': (fm, fnm) => obj_mwu_test(fm, fnm),
            'mwu_thresh': (fm, fnm) => obj_mwu_test_threshold(fm, fnm),
            'weighted_var': (fm, fnm, N) => obj_weighted_variance(fm, fnm, N),
            'atomicity': (fm, fnm, ps) => App.Linkage.rawMatrix ? obj_atomicity(ps, App.Linkage.rawMatrix) : 0,
            'a_plus_i': (fm, fnm, ps) => App.Linkage.rawMatrix ? obj_a_plus_i(ps, App.Linkage.rawMatrix) : 0,
            'star_count': (fm, fnm, ps) => obj_star_count(ps),
            'inverse_star_count': (fm, fnm, ps) => obj_inverse_star_count(ps),
            'independence': (fm, fnm, ps) => App.Linkage.rawMatrix ? obj_independence(ps, App.Linkage.rawMatrix) : 0,
            'robustness': fm => fm.length > 0 ? obj_robustness(fm) : Infinity,
            'sample_count': fm => obj_sample_count(fm),
            'inverse_sample_count': fm => obj_inverse_sample_count(fm)
        },
        displayInverters: {
            'mean_fitness': v => -v, 'mwu': v => v, 'mwu_thresh': v => v, 'weighted_var': v => v,
            'atomicity': v => -v, 'a_plus_i': v => -v, 'star_count': v => -v, 'inverse_star_count': v => v,
            'independence': v => v, 'robustness': v => -v, 'sample_count': v => -v, 'inverse_sample_count': v => v
        }
    },
    Sandbox: {
        mods: new Map()
    },

    // --- Init & Tab Routing ---
    init() {
        fetch('MartinsInstance.json').then(r => r.json()).then(data => {
            App.Data.problem = data;
            data.skillMap = {};
            data.skills.sort();
            data.skills.forEach(s => data.skillMap[s] = []);
            data.workers.forEach((w, i) => {
                w.skills.sort();
                w.skills.forEach(s => data.skillMap[s].push(i));
                w.available_rotas.forEach(r => {
                    if (!App.Data.uniqueRotas.has(r.rota_id)) App.Data.uniqueRotas.set(r.rota_id, r.pattern);
                });
            });
            document.getElementById('p1-progress').textContent = "Martin's Instance Data loaded. Ready to run.";
        }).catch(err => {
            document.getElementById('p1-progress').textContent = "Failed to load data: " + err.message;
        });
    },

    switchTab(tabId) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
        document.querySelector(`.tab-btn[onclick="App.switchTab('${tabId}')"]`).classList.add('active');

        if (tabId === 'page2' && App.Data.bestSol) App.Viewer.render();
        if (tabId === 'page4') App.Miner.updateConstraintUI(); // NEW
        if (tabId === 'page6' && App.Data.bestSol) App.Sandbox.init();
    }
};

window.addEventListener('DOMContentLoaded', () => App.init());

// --- Core Evaluator ---
App.Core = {
    calcRange(matrix) {
        let mins = [...matrix[0]], maxs = [...matrix[0]];
        for (let w = 1; w < matrix.length; w++) {
            for (let d = 0; d < 7; d++) {
                if (matrix[w][d] < mins[d]) mins[d] = matrix[w][d];
                if (matrix[w][d] > maxs[d]) maxs[d] = matrix[w][d];
            }
        }
        let scores = maxs.map((mx, i) => mx === 0 ? 1.0 : Math.pow((mx - mins[i]) / mx, 2));
        return { mins, maxs, scores };
    },

    evaluate(solution) {
        const prob = App.Data.problem;
        let totalRangeScore = 0, unlikedRotas = 0, totalWorkingDays = 0;
        const chosenPats = solution.map((rIdx, i) => {
            if (rIdx !== 0) unlikedRotas++;
            const pat = prob.workers[i].available_rotas[rIdx].pattern;
            totalWorkingDays += pat.filter(x => x === 1).length;
            return pat;
        });

        const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        let colPenalties = new Array(7).fill(0);
        let proxies = { "Total Working Days": totalWorkingDays, "Unpreferred Rotas": unlikedRotas };

        prob.skills.forEach(skill => {
            for (let d = 0; d < 7; d++) proxies[`Penalty: ${skill} - ${weekdays[d]}`] = 0;
            proxies[`Penalty: ${skill} - Total`] = 0;
        });

        prob.skills.forEach(skill => {
            const wIndices = prob.skillMap[skill];
            if (!wIndices || wIndices.length === 0) return;

            let wMatrix = Array.from({ length: 13 }, () => new Array(7).fill(0));
            wIndices.forEach(idx => {
                const pat = chosenPats[idx];
                for (let day = 0; day < prob.calendar_length; day++) {
                    if (pat[day] === 1) wMatrix[Math.floor(day / 7)][day % 7]++;
                }
            });

            const { scores } = this.calcRange(wMatrix);
            let skillTotal = 0;
            for (let d = 0; d < 7; d++) {
                let pen = scores[d] * prob.weights[d];
                skillTotal += pen;
                colPenalties[d] += pen;
                proxies[`Penalty: ${skill} - ${weekdays[d]}`] = pen;
            }
            proxies[`Penalty: ${skill} - Total`] = skillTotal;
            totalRangeScore += skillTotal;
        });

        for (let d = 0; d < 7; d++) proxies[`Penalty: All Skills - ${weekdays[d]}`] = colPenalties[d];
        proxies["Total Range Penalty"] = totalRangeScore;

        return { fitness: -(totalRangeScore + (prob.rota_preference_weight * unlikedRotas)), proxies };
    }
};

// --- Page 1: Solver ---
App.Solver = {
    async execute() {
        if (!App.Data.problem) return alert("Data not loaded.");
        const budget = parseInt(document.getElementById('p1-budget').value, 10);
        const popSize = parseInt(document.getElementById('p1-popsize').value, 10);
        const L = App.Data.problem.workers.length;
        const sSpace = App.Data.problem.workers.map(w => w.available_rotas.length);

        App.Data.pref = [];
        App.Data.proxies = [];
        App.Data.bestFit = -Infinity;

        const canvas = document.getElementById('fitnessCanvas');
        const ctx = canvas.getContext('2d');
        const log = document.getElementById('p1-log');
        let history = [], pop = [];

        for (let i = 0; i < popSize; i++) {
            let sol = sSpace.map(c => Math.floor(Math.random() * c));
            let res = App.Core.evaluate(sol);
            pop.push({ sol, fit: res.fitness });
            res.proxies["Generation"] = 0;
            App.Data.pref.push({ solution: sol, fitness: res.fitness, generation: 0 });
            App.Data.proxies.push(res.proxies);
            if (res.fitness > App.Data.bestFit) { App.Data.bestFit = res.fitness; App.Data.bestSol = [...sol]; }
        }

        let evals = popSize, gen = 1;
        log.textContent = `Optimizing ${L} variables...\n`;

        while (evals < budget) {
            let children = [];
            for (let i = 0; i < popSize; i++) {
                if (evals >= budget) break;
                let p1 = pop[Math.floor(Math.random() * popSize)];
                let p2 = pop[Math.floor(Math.random() * popSize)];
                for(let k=0; k<2; k++) {
                    let c = pop[Math.floor(Math.random() * popSize)];
                    if(c.fit > p1.fit) p1 = c;
                }

                let child = new Array(L);
                for (let j = 0; j < L; j++) {
                    child[j] = Math.random() < 0.5 ? p1.sol[j] : p2.sol[j];
                    if (Math.random() < (1.0 / L)) child[j] = Math.floor(Math.random() * sSpace[j]);
                }

                let res = App.Core.evaluate(child);
                evals++;
                children.push({ sol: child, fit: res.fitness });
                res.proxies["Generation"] = gen;
                App.Data.pref.push({ solution: child, fitness: res.fitness, generation: gen });
                App.Data.proxies.push(res.proxies);

                if (res.fitness > App.Data.bestFit) { App.Data.bestFit = res.fitness; App.Data.bestSol = [...child]; }
            }

            pop = pop.concat(children).sort((a, b) => b.fit - a.fit).slice(0, popSize);
            history.push(App.Data.bestFit);
            gen++;

            if (gen % 5 === 0) {
                ctx.clearRect(0,0,canvas.width,canvas.height);
                ctx.beginPath();
                ctx.strokeStyle = '#3498db';
                let range = Math.max(...history) - Math.min(...history) || 1;
                history.forEach((f, i) => {
                    let x = (i / history.length) * canvas.width;
                    let y = canvas.height - ((f - Math.min(...history)) / range) * canvas.height;
                    if (i===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                ctx.stroke();
                document.getElementById('p1-progress').textContent = `Evaluations: ${evals}/${budget}`;
                await new Promise(r => setTimeout(r, 0));
            }
        }
        log.textContent += `Done. Best: ${App.Data.bestFit.toFixed(5)}\nPRef database populated.`;
    }
};

// --- Page 2: Viewer ---
App.Viewer = {
    comparedItems: [],

    render() {
        document.getElementById('p2-fit-summary').textContent = `Best Fitness: ${App.Data.bestFit.toFixed(5)}`;
        const prob = App.Data.problem;

        // Skill Matrix
        document.getElementById('p2-skill-matrix-head').innerHTML = '<tr><th>Skill</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Sun</th><th>Total Score</th></tr>';
        let mBody = '';
        prob.skills.forEach(skill => {
            let wMatrix = Array.from({ length: 13 }, () => new Array(7).fill(0));
            (prob.skillMap[skill] || []).forEach(idx => {
                const pat = prob.workers[idx].available_rotas[App.Data.bestSol[idx]].pattern;
                for (let d = 0; d < 91; d++) if (pat[d] === 1) wMatrix[Math.floor(d/7)][d%7]++;
            });
            const { mins, maxs, scores } = App.Core.calcRange(wMatrix);
            mBody += `<tr><td><strong>${skill}</strong></td>`;
            let total = 0;
            for (let d = 0; d < 7; d++) {
                total += scores[d] * prob.weights[d];
                mBody += `<td style="background-color: hsl(${(1 - scores[d]) * 120}, 70%, 80%)">${mins[d]} - ${maxs[d]}<br>(${scores[d].toFixed(2)})</td>`;
            }
            mBody += `<td><strong>${total.toFixed(4)}</strong></td></tr>`;
        });
        document.getElementById('p2-skill-matrix-body').innerHTML = mBody;

        // Daily Deployment
        let dHead = '<tr><th>Day</th>';
        prob.skills.forEach(s => dHead += `<th>${s.replace('SKILL_', 'S_')}</th>`);
        dHead += '</tr>';
        document.getElementById('p2-daily-head').innerHTML = dHead;

        let dBody = '';
        const wDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        for (let d = 0; d < prob.calendar_length; d++) {
            dBody += `<tr><td>${d+1} (${wDays[d%7]})</td>`;
            prob.skills.forEach(skill => {
                let count = 0;
                (prob.skillMap[skill] || []).forEach(idx => {
                    // FIX: changed pattern[day] to pattern[d]
                    if (prob.workers[idx].available_rotas[App.Data.bestSol[idx]].pattern[d] === 1) count++;
                });
                dBody += `<td>${count}</td>`;
            });
            dBody += `</tr>`;
        }
        document.getElementById('p2-daily-body').innerHTML = dBody;

        // Roster Basic Details
        let eBody = '', cWorker = '<option value="">-- Add Worker --</option>';
        prob.workers.forEach((w, i) => {
            const rIdx = App.Data.bestSol[i];
            const rIds = w.available_rotas.map(r => r.rota_id).join(', ');
            eBody += `<tr><td>${w.worker_id}</td><td>Opt #${rIdx} (${w.available_rotas[rIdx].rota_id})</td><td>${w.skills.join(', ')}</td><td>${rIds}</td></tr>`;
            cWorker += `<option value="${i}">${w.name} (Opt #${rIdx})</option>`;
        });
        document.getElementById('p2-emp-table-body').innerHTML = eBody;
        document.getElementById('p2-compare-worker').innerHTML = cWorker;

        let cRota = '<option value="">-- Add Rota Directly --</option>';
        Array.from(App.Data.uniqueRotas.keys()).sort().forEach(r => cRota += `<option value="${r}">${r}</option>`);
        document.getElementById('p2-compare-rota').innerHTML = cRota;

        this.renderCompare();
    },

    addComparison() {
        const wIdx = document.getElementById('p2-compare-worker').value;
        const rId = document.getElementById('p2-compare-rota').value;
        if (wIdx && !this.comparedItems.some(i => i.type === 'w' && i.id == wIdx)) this.comparedItems.push({type: 'w', id: parseInt(wIdx)});
        else if (rId && !this.comparedItems.some(i => i.type === 'r' && i.id == rId)) this.comparedItems.push({type: 'r', id: rId});
        this.renderCompare();
    },

    clearComparison() { this.comparedItems = []; this.renderCompare(); },

    renderCompare() {
        const head = document.getElementById('p2-compare-head');
        const body = document.getElementById('p2-compare-body');
        if (this.comparedItems.length === 0) {
            head.innerHTML = '<tr><th>Day</th><th>Weekday</th></tr>';
            body.innerHTML = '<tr><td colspan="2">Select workers or rotas to compare.</td></tr>';
            return;
        }

        let hHtml = '<tr><th>Day</th><th>Wk</th>';
        this.comparedItems.forEach(item => {
            if (item.type === 'w') {
                let rIdx = App.Data.bestSol[item.id];
                hHtml += `<th>${App.Data.problem.workers[item.id].name}<br><span style="font-weight:normal;">${App.Data.problem.workers[item.id].available_rotas[rIdx].rota_id}</span></th>`;
            } else {
                hHtml += `<th>Raw Rota<br><span style="font-weight:normal;">${item.id}</span></th>`;
            }
        });
        head.innerHTML = hHtml + '</tr>';

        let bHtml = '';
        const wDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        for(let d = 0; d < 91; d++) {
            bHtml += `<tr><td>${d+1}</td><td>${wDays[d%7]}</td>`;
            this.comparedItems.forEach(item => {
                let isW = item.type === 'w' ? App.Data.problem.workers[item.id].available_rotas[App.Data.bestSol[item.id]].pattern[d] === 1 : App.Data.uniqueRotas.get(item.id)[d] === 1;
                bHtml += `<td style="background-color: ${isW ? '#27ae60' : '#ebedef'}; color: ${isW ? '#fff' : '#333'}; text-align: center; font-weight: bold;">${isW ? 'W' : 'Off'}</td>`;
            });
            bHtml += '</tr>';
        }
        body.innerHTML = bHtml;
    }
};

// --- Page 3: Linkage ---
App.Linkage = {
    async calcPerturbation() {
        const L = App.Data.problem.workers.length;
        const matrix = Array.from({length: L}, () => new Array(L).fill(0));
        const effects1D = Array.from({length: L}, () => ({}));
        const baseFit = App.Core.evaluate(App.Data.bestSol).fitness;

        for (let i = 0; i < L; i++) {
            const numOpts = App.Data.problem.workers[i].available_rotas.length;
            for (let v = 0; v < numOpts; v++) {
                if (v !== App.Data.bestSol[i]) {
                    let sol = [...App.Data.bestSol]; sol[i] = v;
                    effects1D[i][v] = App.Core.evaluate(sol).fitness - baseFit;
                } else effects1D[i][v] = 0;
            }
        }

        let done = 0;
        for (let i = 0; i < L; i++) {
            for (let j = i + 1; j < L; j++) {
                let sum = 0, count = 0;
                for (let vi = 0; vi < App.Data.problem.workers[i].available_rotas.length; vi++) {
                    if (vi === App.Data.bestSol[i]) continue;
                    for (let vj = 0; vj < App.Data.problem.workers[j].available_rotas.length; vj++) {
                        if (vj === App.Data.bestSol[j]) continue;
                        let sol = [...App.Data.bestSol]; sol[i] = vi; sol[j] = vj;
                        sum += Math.abs((App.Core.evaluate(sol).fitness - baseFit) - (effects1D[i][vi] + effects1D[j][vj]));
                        count++;
                    }
                }
                matrix[i][j] = matrix[j][i] = count > 0 ? (sum / count) : 0;
                if (++done % 500 === 0) {
                    document.getElementById('p3-status').textContent = `Calculating Perturbation: ${done} pairs...`;
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        }
        return matrix;
    },

    async calculate() {
        if (App.Data.pref.length === 0) return alert("Run solver first.");
        const method = document.getElementById('p3-method').value;
        document.getElementById('p3-status').textContent = "Calculating Linkage...";
        await new Promise(r => setTimeout(r, 20));

        let raw;
        if (method === 'perturbation') raw = await this.calcPerturbation();
        else {
            const sols = App.Data.pref.map(p => p.solution), fits = App.Data.pref.map(p => p.fitness);
            if (method === 'dominance') raw = dominance_linkage(sols, fits);
            else if (method === 'misurvival') raw = misurvival_linkage(sols, fits);
            else raw = traditional_mutual_information(sols, fits); //[cite: 2]
        }

        const L = App.Data.problem.workers.length;
        App.Linkage.rawMatrix = Array.from({length: L}, () => new Array(L).fill(0));
        App.Linkage.visualMatrix = Array.from({length: L}, () => new Array(L).fill(0));

        for (let i = 0; i < L; i++) {
            for (let j = 0; j < L; j++) {
                let num = (raw[i][j] === "" || isNaN(raw[i][j])) ? 0 : Number(raw[i][j]);
                App.Linkage.rawMatrix[i][j] = App.Linkage.visualMatrix[i][j] = num;
            }
        }

        this.renderHeatmap();
        document.getElementById('p3-status').textContent = "Linkage Matrix calculated.";
        document.getElementById('p3-sort-btn').disabled = false;

        let wSel = document.getElementById('p3-worker-select');
        wSel.innerHTML = '<option value="">-- Select Worker --</option>';
        App.Data.problem.workers.forEach((w, i) => wSel.innerHTML += `<option value="${i}">${w.name}</option>`);
    },

    reorderGreedy() {
        const L = App.Linkage.visualMatrix.length;
        let unvisited = new Set(Array.from({length: L}, (_, i) => i));
        let perm = [0]; unvisited.delete(0);

        while (unvisited.size > 0) {
            let best = -1, minD = Infinity, curr = perm[perm.length - 1];
            for (let cand of unvisited) {
                let d = 0;
                for (let k = 0; k < L; k++) d += Math.abs(App.Linkage.visualMatrix[curr][k] - App.Linkage.visualMatrix[cand][k]);
                if (d < minD) { minD = d; best = cand; }
            }
            perm.push(best); unvisited.delete(best);
        }

        let minSum = Infinity, minIndex = 0;
        for (let r = 0; r < L; r++) {
            let sum = 0;
            for (let c = 0; c < L; c++) sum += App.Linkage.visualMatrix[perm[r]][perm[c]];
            if (sum < minSum) { minSum = sum; minIndex = r; }
        }
        let nPerm = perm.slice(minIndex).concat(perm.slice(0, minIndex));

        const reordered = Array.from({length: L}, () => new Array(L).fill(0));
        for (let r = 0; r < L; r++) for (let c = 0; c < L; c++) reordered[r][c] = App.Linkage.visualMatrix[nPerm[r]][nPerm[c]];
        App.Linkage.visualMatrix = reordered;
        this.renderHeatmap();
    },

    renderHeatmap() {
        const canvas = document.getElementById('matrixCanvas');
        const ctx = canvas.getContext('2d');
        const L = App.Linkage.visualMatrix.length;
        const s = canvas.width / L;
        let maxV = 0;
        for (let i=0; i<L; i++) for (let j=0; j<L; j++) if(App.Linkage.visualMatrix[i][j] > maxV) maxV = App.Linkage.visualMatrix[i][j];

        ctx.clearRect(0,0,canvas.width,canvas.height);
        for (let i=0; i<L; i++) {
            for (let j=0; j<L; j++) {
                ctx.fillStyle = i === j ? '#fff' : `rgba(230, 126, 34, ${maxV > 0 ? App.Linkage.visualMatrix[i][j] / maxV : 0})`;
                ctx.fillRect(j*s, i*s, s, s);
            }
        }
    },

    showWorker() {
        let wIdx = parseInt(document.getElementById('p3-worker-select').value, 10);
        if (isNaN(wIdx)) return;
        let linkages = [];
        for (let i = 0; i < App.Data.problem.workers.length; i++) {
            if (i !== wIdx) linkages.push({ name: App.Data.problem.workers[i].name, score: App.Linkage.rawMatrix[wIdx][i] });
        }
        linkages.sort((a,b) => b.score - a.score);

        let tbody = document.getElementById('p3-linkage-results');
        tbody.innerHTML = '';
        let rank = 1;
        linkages.forEach((l) => {
            if (l.score > 0) tbody.innerHTML += `<tr><td>${rank++}</td><td>${l.name}</td><td>${l.score.toFixed(4)}</td></tr>`;
        });
        if(tbody.innerHTML === '') tbody.innerHTML = '<tr><td colspan="3">No positive linkages found.</td></tr>';
    }
};

// --- Page 4 & 5: PS Miner ---
App.Miner = {
    results: [],
    displayedItems: [], // UI Source of Truth
    activeMetrics: [],
    names: {
        'mean_fitness': 'Mean Fitness', 'mwu': 'MWU P-Val', 'mwu_thresh': 'MWU (Thresh)',
        'weighted_var': 'Weighted Var', 'atomicity': 'Atomicity', 'a_plus_i': 'Atomicity + Ind',
        'star_count': 'Star-count', 'inverse_star_count': 'Inverse Stars', 'independence': 'Dependence',
        'robustness': 'Robustness', 'sample_count': 'Sample Count', 'inverse_sample_count': 'Inv Samples'
    },
    evaluators: {
        'mean_fitness': fm => fm.length > 0 ? obj_mean_fitness(fm) : Infinity,
        'mwu': (fm, fnm) => obj_mwu_test(fm, fnm),
        'mwu_thresh': (fm, fnm) => obj_mwu_test_threshold(fm, fnm),
        'weighted_var': (fm, fnm, N) => obj_weighted_variance(fm, fnm, N),
        'atomicity': (fm, fnm, ps) => App.Linkage.rawMatrix ? obj_atomicity(ps, App.Linkage.rawMatrix) : 0,
        'a_plus_i': (fm, fnm, ps) => App.Linkage.rawMatrix ? obj_a_plus_i(ps, App.Linkage.rawMatrix) : 0,
        'star_count': (fm, fnm, ps) => obj_star_count(ps),
        'inverse_star_count': (fm, fnm, ps) => obj_inverse_star_count(ps),
        'independence': (fm, fnm, ps) => App.Linkage.rawMatrix ? obj_independence(ps, App.Linkage.rawMatrix) : 0,
        'robustness': fm => fm.length > 0 ? obj_robustness(fm) : Infinity,
        'sample_count': fm => obj_sample_count(fm),
        'inverse_sample_count': fm => obj_inverse_sample_count(fm)
    },
    displayInverters: {
        'mean_fitness': v => -v, 'mwu': v => v, 'mwu_thresh': v => v, 'weighted_var': v => v,
        'atomicity': v => -v, 'a_plus_i': v => -v, 'star_count': v => -v, 'inverse_star_count': v => v,
        'independence': v => v, 'robustness': v => -v, 'sample_count': v => -v, 'inverse_sample_count': v => v
    },

    updateConstraintUI() {
        const type = document.getElementById('p4-constraint-type').value;
        const detailsDiv = document.getElementById('p4-constraint-details');

        if (type === 'none') {
            detailsDiv.style.display = 'none';
            return;
        }
        detailsDiv.style.display = 'block';

        const wSel = document.getElementById('p4-constraint-worker');
        const rSel = document.getElementById('p4-constraint-rota');

        if (wSel.options.length === 0 && App.Data.problem) {
            wSel.innerHTML = '<option value="">-- Select Worker --</option>';
            App.Data.problem.workers.forEach((w, i) => {
                wSel.innerHTML += `<option value="${i}">${w.name}</option>`;
            });
        }

        const wIdxStr = wSel.value;
        if (wIdxStr !== '') {
            const wIdx = parseInt(wIdxStr, 10);
            const currentSelectedRota = rSel.value;
            rSel.innerHTML = '';
            App.Data.problem.workers[wIdx].available_rotas.forEach((r, i) => {
                rSel.innerHTML += `<option value="${i}">Option #${i} (${r.rota_id})</option>`;
            });
            if (currentSelectedRota) rSel.value = currentSelectedRota;
        } else {
            rSel.innerHTML = '<option value="">-- First Select Worker --</option>';
        }
    },

    async execute() {
        if (App.Data.pref.length === 0) return alert("Run solver first.");
        this.activeMetrics = Array.from(document.querySelectorAll('#p4-obj-list input:checked')).map(cb => cb.value);
        if (this.activeMetrics.length === 0) return alert("Select at least one metric.");

        const runBtn = document.getElementById('p4-run-btn');
        const status = document.getElementById('p4-status');

        runBtn.disabled = true;
        runBtn.textContent = "Initializing Search...";
        status.textContent = "Setting up NSGA-II engine and checking constraints...";
        await new Promise(r => setTimeout(r, 50));

        window.MinedDB = new PRefDatabase(App.Data.pref.map(p => p.solution), App.Data.pref.map(p => p.fitness));
        const db = window.MinedDB;
        const L = App.Data.problem.workers.length;

        let objFuncs = this.activeMetrics.map(id => ps => {
            let { matchIndices, notMatchIndices } = db.getMatches(ps);
            let { fMatch, fNotMatch } = db.getFitnessArrays(matchIndices, notMatchIndices);
            let v = this.evaluators[id](fMatch, fNotMatch, ps, db.N);
            return (isNaN(v) || v === null) ? Infinity : v;
        });

        const budget = parseInt(document.getElementById('p4-budget').value, 10);
        const popSize = parseInt(document.getElementById('p4-popsize').value, 10);
        const scope = document.getElementById('p4-scope').value;

        document.getElementById('desc-ref').value = scope;

        let constraint = { type: 'none' };
        const cType = document.getElementById('p4-constraint-type').value;
        if (cType !== 'none') {
            const wIdx = parseInt(document.getElementById('p4-constraint-worker').value, 10);
            const rIdx = parseInt(document.getElementById('p4-constraint-rota').value, 10);
            if (!isNaN(wIdx) && !isNaN(rIdx)) {
                constraint = { type: cType, worker: wIdx, rota: rIdx };
            }
        }
        const searchSpace = App.Data.problem.workers.map(w => w.available_rotas.length);

        const applyConstraint = (ps, c, sSpace) => {
            if (c.type === 'none') return ps;
            let w = c.worker;
            let r = c.rota;

            if (c.type === 'must') {
                ps[w] = r;
            } else if (c.type === 'must_not') {
                if (ps[w] === -1 || ps[w] === r) {
                    let opts = [];
                    for (let i = 0; i < sSpace[w]; i++) {
                        if (i !== r) opts.push(i);
                    }
                    ps[w] = opts.length > 0 ? opts[Math.floor(Math.random() * opts.length)] : r;
                }
            }
            return ps;
        };

        // --- NEW: Non-Local Constraint ---
        const applyNonLocalConstraint = (ps, bestSol, sSpace) => {
            for (let i = 0; i < ps.length; i++) {
                if (ps[i] !== -1 && ps[i] === bestSol[i]) {
                    let opts = [];
                    for (let r = 0; r < sSpace[i]; r++) {
                        if (r !== bestSol[i]) opts.push(r);
                    }
                    // If an alternative exists, pick it. Otherwise, fallback to a wildcard (-1)
                    ps[i] = opts.length > 0 ? opts[Math.floor(Math.random() * opts.length)] : -1;
                }
            }
            return ps;
        };

        let operators;
        if (scope === 'global') {
            operators = {
                sample: () => applyConstraint(OperatorsGlobal.sample(L, searchSpace), constraint, searchSpace),
                mutate: (ps) => applyConstraint(OperatorsGlobal.mutate(ps, L, searchSpace), constraint, searchSpace),
                crossover: (p1, p2) => {
                    let [c1, c2] = OperatorsGlobal.crossover(p1, p2, L);
                    return [applyConstraint(c1, constraint, searchSpace), applyConstraint(c2, constraint, searchSpace)];
                }
            };
        } else if (scope === 'local') {
            operators = {
                sample: () => applyConstraint(OperatorsLocal.sample(L, App.Data.bestSol), constraint, searchSpace),
                mutate: (ps) => applyConstraint(OperatorsLocal.mutate(ps, L, App.Data.bestSol), constraint, searchSpace),
                crossover: (p1, p2) => {
                    let [c1, c2] = OperatorsGlobal.crossover(p1, p2, L);
                    return [applyConstraint(c1, constraint, searchSpace), applyConstraint(c2, constraint, searchSpace)];
                }
            };
        } else if (scope === 'non_local') {
            operators = {
                sample: () => applyConstraint(applyNonLocalConstraint(OperatorsGlobal.sample(L, searchSpace), App.Data.bestSol, searchSpace), constraint, searchSpace),
                mutate: (ps) => applyConstraint(applyNonLocalConstraint(OperatorsGlobal.mutate(ps, L, searchSpace), App.Data.bestSol, searchSpace), constraint, searchSpace),
                crossover: (p1, p2) => {
                    let [c1, c2] = OperatorsGlobal.crossover(p1, p2, L);
                    c1 = applyNonLocalConstraint(c1, App.Data.bestSol, searchSpace);
                    c2 = applyNonLocalConstraint(c2, App.Data.bestSol, searchSpace);
                    return [applyConstraint(c1, constraint, searchSpace), applyConstraint(c2, constraint, searchSpace)];
                }
            };
        }

        status.textContent = "Running NSGA-II Generations...";
        runBtn.textContent = "Mining in Progress...";
        await new Promise(r => setTimeout(r, 50));

        const nsga = new PS_NSGAII(L, searchSpace, objFuncs, budget, popSize, operators); //[cite: 2]
        let res = await nsga.run();

        this.results = res.map(ind => {
            let { matchIndices } = db.getMatches(ind.ps);
            let metrics = {};
            this.activeMetrics.forEach((id, index) => {
                let nsgaVal = ind.objectives[index];
                let displayValue = this.displayInverters[id](nsgaVal);
                metrics[id] = { name: this.names[id], val: displayValue, nsga_min: nsgaVal };
            });

            return {
                ps: ind.ps,
                fixed: ind.ps.filter(x => x !== -1).length,
                samples: matchIndices.size,
                metrics: metrics,
                zSum: ind.z_sum
            };
        });

        const sortSel = document.getElementById('p5-sort');
        sortSel.innerHTML = '<option value="minimax">Minimax Regret</option>';
        this.activeMetrics.forEach(id => {
            sortSel.innerHTML += `<option value="${id}">${this.names[id]}</option>`;
        });

        status.textContent = `Done. Found ${this.results.length} non-dominated patterns.`;
        runBtn.disabled = false;
        runBtn.textContent = "Run PS Mining";
        this.renderCards();
        App.switchTab('page5');
    },

    renderCards() {
        const container = document.getElementById('p5-container');
        if (this.results.length === 0) {
            container.innerHTML = "No Partial Solutions discovered yet.";
            return;
        }

        let items = [...this.results];
        const sortBy = document.getElementById('p5-sort').value;
        const doCluster = document.getElementById('p5-cluster').checked;

        if (sortBy === 'minimax') {
            items.sort((a, b) => a.zSum - b.zSum);
        } else {
            items.sort((a, b) => a.metrics[sortBy].nsga_min - b.metrics[sortBy].nsga_min);
        }

        if (doCluster && items.length > 0) {
            let bestItem = items[0];
            let minSum = Infinity;
            for (let i = 0; i < items.length; i++) {
                let sum = 0;
                for (let j = 0; j < items.length; j++) {
                    for (let k = 0; k < items[i].ps.length; k++) {
                        if (items[i].ps[k] === items[j].ps[k]) continue;
                        sum += (items[i].ps[k] === -1 || items[j].ps[k] === -1) ? 1.0 : 0.9;
                    }
                }
                if (sum < minSum) {
                    minSum = sum;
                    bestItem = items[i];
                }
            }
            items = [bestItem];
        }

        // Store the items exactly as they will be displayed so button indexes match
        this.displayedItems = items;

        container.innerHTML = '';
        items.forEach((item, idx) => {
            let rulesHtml = '<table class="data-table" style="margin-top: 10px;"><thead><tr><th>Worker</th><th>Instruction</th></tr></thead><tbody>';
            for(let j=0; j < item.ps.length; j++) {
                if(item.ps[j] !== -1) {
                    const w = App.Data.problem.workers[j];
                    const rIdx = item.ps[j];
                    const rObj = w.available_rotas[rIdx];
                    rulesHtml += `<tr>
                        <td><strong>${w.name}</strong><br><span style="font-size: 10px; color: #666;">${w.skills.join(', ')}</span></td>
                        <td>Assign Option #${rIdx} (${rObj.rota_id})<br><span style="font-size: 10px; color: #666;">Pref: ${rObj.preference_rank}</span></td>
                    </tr>`;
                }
            }
            rulesHtml += '</tbody></table>';

            let metricHtml = `<span class="ps-tag" style="background:#27ae60; color:#fff;">Matches: ${item.samples}</span>`;
            this.activeMetrics.forEach(id => {
                let v = item.metrics[id].val;
                let displayValue = (id.includes('mwu') ? v.toExponential(3) : v.toFixed(4));
                if (id.includes('count')) displayValue = Math.abs(v).toString();
                metricHtml += `<span class="ps-tag">${this.names[id]}: ${displayValue}</span>`;
            });

            container.innerHTML += `
                <div class="ps-card">
                    <div class="ps-title" onclick="document.getElementById('ps-rules-${idx}').classList.toggle('expanded')">
                        Partial Solution ${idx + 1} (${item.fixed} Fixed Workers) <span style="font-weight:normal; font-size: 10px;">▼ Click to expand Rules</span>
                    </div>
                    <div style="margin: 8px 0;">${metricHtml}</div>
                    <div id="ps-rules-${idx}" class="ps-rules-content">
                        <strong>Fixed Assignments:</strong><br>
                        ${rulesHtml}
                    </div>
                    <div style="margin-top:10px;">
                        <button class="action-btn" onclick="App.Miner.calcDescriptors(${idx}, this)">Calculate Descriptors</button>
                        <div id="desc-out-${idx}" class="desc-output" style="margin-top: 10px;"></div>
                    </div>
                </div>`;
        });
    },

    clearDescriptors() {
        document.querySelectorAll('.desc-output').forEach(el => el.innerHTML = '');
    },

    async calcDescriptors(uiIndex, btn) {
        if (!window.MinedDB || App.Data.proxies.length === 0) return alert("Proxy Data missing.");

        let threshold = parseFloat(document.getElementById('desc-threshold').value) || 0.1;
        let samples = parseInt(document.getElementById('desc-samples').value, 10) || 500;
        let isLocal = document.getElementById('desc-ref').value === 'local';
        let targetSol = isLocal ? App.Data.bestSol : null;

        let item = this.displayedItems[uiIndex];
        let area = document.getElementById(`desc-out-${uiIndex}`);

        area.innerHTML = `<em>Calculating descriptors across ${samples} random PS configurations...</em>`;
        if (btn) btn.style.display = 'none';
        await new Promise(r => setTimeout(r, 20));

        let fixed_count = item.ps.filter(x => x !== -1).length;
        let L = item.ps.length;
        let sSpace = App.Data.problem.workers.map(w => w.available_rotas.length);
        let normalKeys = Object.keys(App.Data.proxies[0]);
        let results = [];

        let { matchIndices } = window.MinedDB.getMatches(item.ps);
        if (matchIndices.size === 0) {
            if (btn) btn.style.display = 'inline-block';
            return area.innerHTML = "No matches found.";
        }

        // --- NEW: Calculate PS-Specific Structural Metrics ---
        const getPSMetrics = (pattern) => {
            let fixed = pattern.map((rIdx, wIdx) => ({rIdx, wIdx})).filter(x => x.rIdx !== -1);
            let m = {
                "PS: Avg Hamming Distance": 0,
                "PS: Avg Skill Jaccard": 0,
                "PS: Preferred Rotas Count": 0,
                "PS: Union of Skills Size": 0
            };

            if (fixed.length === 0) return m;

            let allSkills = new Set();
            let prefCount = 0;

            fixed.forEach(({rIdx, wIdx}) => {
                const w = App.Data.problem.workers[wIdx];
                if (w.available_rotas[rIdx].preference_rank === 0) prefCount++;
                w.skills.forEach(s => allSkills.add(s));
            });

            m["PS: Preferred Rotas Count"] = prefCount;
            m["PS: Union of Skills Size"] = allSkills.size;

            if (fixed.length > 1) {
                let totalHamming = 0, totalJaccard = 0, pairs = 0;

                for (let i = 0; i < fixed.length; i++) {
                    for (let j = i + 1; j < fixed.length; j++) {
                        let wA = App.Data.problem.workers[fixed[i].wIdx];
                        let wB = App.Data.problem.workers[fixed[j].wIdx];
                        let pA = wA.available_rotas[fixed[i].rIdx].pattern;
                        let pB = wB.available_rotas[fixed[j].rIdx].pattern;

                        // Hamming Distance
                        let hamming = 0;
                        for (let d = 0; d < pA.length; d++) {
                            if (pA[d] !== pB[d]) hamming++;
                        }
                        totalHamming += hamming;

                        // Jaccard Similarity (Intersection / Union)
                        let sA = new Set(wA.skills), sB = new Set(wB.skills);
                        let intersection = 0;
                        sA.forEach(s => { if (sB.has(s)) intersection++; });
                        let union = sA.size + sB.size - intersection;
                        totalJaccard += union === 0 ? 0 : (intersection / union);

                        pairs++;
                    }
                }
                m["PS: Avg Hamming Distance"] = totalHamming / pairs;
                m["PS: Avg Skill Jaccard"] = totalJaccard / pairs;
            }
            return m;
        };

        // Combine traditional proxies with the new PS structural metrics
        let targetPSMetrics = getPSMetrics(item.ps);
        let psKeys = Object.keys(targetPSMetrics);
        let allKeys = [...normalKeys, ...psKeys];

        let matchArr = Array.from(matchIndices);
        let target_avgs = {};
        allKeys.forEach(k => target_avgs[k] = 0);

        // Average out the traditional proxies
        for (let i = 0; i < matchArr.length; i++) {
            let pData = App.Data.proxies[matchArr[i]];
            for (let j = 0; j < normalKeys.length; j++) target_avgs[normalKeys[j]] += pData[normalKeys[j]];
        }
        normalKeys.forEach(k => target_avgs[k] /= matchArr.length);

        // Attach the calculated PS properties directly
        psKeys.forEach(k => target_avgs[k] = targetPSMetrics[k]);

        let sampled_avgs = {};
        allKeys.forEach(k => sampled_avgs[k] = []);

        for (let s = 0; s < samples; s++) {
            let rPS = new Array(L).fill(-1);
            let indices = Array.from({length: L}, (_, idx) => idx).sort(() => 0.5 - Math.random());
            for (let j = 0; j < fixed_count; j++) {
                let idx = indices[j];
                rPS[idx] = targetSol ? targetSol[idx] : Math.floor(Math.random() * sSpace[idx]);
            }

            let r_matches = window.MinedDB.getMatches(rPS).matchIndices;
            if (r_matches.size > 0) {
                let rMatchArr = Array.from(r_matches);
                let sums = {};
                normalKeys.forEach(k => sums[k] = 0);

                for(let m = 0; m < rMatchArr.length; m++) {
                    let pData = App.Data.proxies[rMatchArr[m]];
                    for(let k = 0; k < normalKeys.length; k++) sums[normalKeys[k]] += pData[normalKeys[k]];
                }
                normalKeys.forEach(k => sampled_avgs[k].push(sums[k] / rMatchArr.length));

                // Evaluate structural metrics on the random PS and push to the distribution
                let rPSM = getPSMetrics(rPS);
                psKeys.forEach(k => sampled_avgs[k].push(rPSM[k]));
            }
        }

        allKeys.forEach(k => {
            let target_val = target_avgs[k];
            let dist = sampled_avgs[k];

            if (dist.length === 0 || isNaN(target_val)) return;

            dist.sort((a,b) => a - b);

            let lower_count = 0, equal_count = 0;
            for (let v of dist) {
                if (Math.abs(v - target_val) <= 1e-9) equal_count++;
                else if (v < target_val) lower_count++;
                else break;
            }

            let pStart = lower_count / dist.length;
            let pEnd = (lower_count + equal_count) / dist.length;

            let finalP;
            if (pStart <= 0.5 && pEnd >= 0.5) finalP = 0.5;
            else if (Math.abs(pStart - 0.5) < Math.abs(pEnd - 0.5)) finalP = pStart;
            else finalP = pEnd;

            if (finalP <= threshold || finalP >= (1 - threshold)) {
                results.push({ name: k, average: target_val, percentile: finalP });
            }
        });

        this.renderDescriptors(area, results, threshold);
        if (btn) btn.style.display = 'inline-block';
    },

    renderDescriptors(area, descriptors, threshold) {
        // FIX: Realigned variable names to match the UI build logic
        let gridDescriptors = [], dayLevelDescriptors = [], skillLevelDescriptors = [], otherDescriptors = [];

        descriptors.forEach(d => {
            let gMatch = d.name.match(/^Penalty:\s+(.+?)\s+-\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
            let dMatch = d.name.match(/^Penalty:\s+All Skills\s+-\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
            let sMatch = d.name.match(/^Penalty:\s+(.+?)\s+-\s+Total$/);

            if (gMatch && gMatch[1] !== "All Skills") gridDescriptors.push({ ...d, skill: gMatch[1], day: gMatch[2] });
            else if (dMatch) dayLevelDescriptors.push({ ...d, day: dMatch[1] });
            else if (sMatch) skillLevelDescriptors.push({ ...d, skill: sMatch[1] });
            else otherDescriptors.push(d);
        });

        let html = `<strong>Extreme Descriptors (Threshold ${(threshold * 100).toFixed(0)}%):</strong><br>`;

        if (skillLevelDescriptors.length > 0) {
            html += `<table class="data-table small-grid"><thead><tr><th>Relevant Skills</th>`;
            skillLevelDescriptors.forEach(d => html += `<th>${d.skill}</th>`);
            html += `</tr></thead><tbody><tr><td>Status</td>`;
            skillLevelDescriptors.forEach(d => {
                let isHigh = d.percentile > 0.5;
                html += `<td class="${isHigh ? 'desc-high' : 'desc-low'}">${isHigh ? 'HIGH' : 'LOW'}<br><span class="desc-avg">${d.average.toFixed(2)} (P:${(d.percentile*100).toFixed(0)}%)</span></td>`;
            });
            html += `</tr></tbody></table>`;
        }

        if (dayLevelDescriptors.length > 0) {
            html += `<table class="data-table small-grid"><thead><tr><th>Relevant Days</th>`;
            dayLevelDescriptors.forEach(d => html += `<th>${d.day}</th>`);
            html += `</tr></thead><tbody><tr><td>Status</td>`;
            dayLevelDescriptors.forEach(d => {
                let isHigh = d.percentile > 0.5;
                html += `<td class="${isHigh ? 'desc-high' : 'desc-low'}">${isHigh ? 'HIGH' : 'LOW'}<br><span class="desc-avg">${d.average.toFixed(2)} (P:${(d.percentile*100).toFixed(0)}%)</span></td>`;
            });
            html += `</tr></tbody></table>`;
        }

        if (gridDescriptors.length > 3) {
            let skillsSet = new Set(gridDescriptors.map(g => g.skill));
            let skillsArr = Array.from(skillsSet).sort();

            let tableHtml = `<table class="data-table small-grid"><thead><tr><th>Skill/Day</th>`;
            const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
            weekdays.forEach(day => tableHtml += `<th>${day}</th>`);
            tableHtml += `</tr></thead><tbody>`;

            skillsArr.forEach(skill => {
                tableHtml += `<tr><td><strong>${skill}</strong></td>`;
                weekdays.forEach(day => {
                    let cellData = gridDescriptors.find(g => g.skill === skill && g.day === day);
                    if (cellData) {
                        let isHigh = cellData.percentile > 0.5;
                        tableHtml += `<td class="${isHigh ? 'desc-high' : 'desc-low'}">${isHigh ? 'HIGH' : 'LOW'}<br><span class="desc-avg">${cellData.average.toFixed(2)} (P:${(cellData.percentile*100).toFixed(0)}%)</span></td>`;
                    } else {
                        tableHtml += `<td></td>`;
                    }
                });
                tableHtml += `</tr>`;
            });
            tableHtml += `</tbody></table>`;
            html += tableHtml;
        } else {
            otherDescriptors.push(...gridDescriptors);
        }

        if (otherDescriptors.length === 0 && gridDescriptors.length <= 3 && skillLevelDescriptors.length === 0 && dayLevelDescriptors.length === 0) {
            html += `<em>No extreme descriptors found within threshold boundaries.</em>`;
        } else {
            otherDescriptors.forEach(d => {
                let isHigh = d.percentile > 0.5;
                html += `<span class="ps-tag" style="background:${isHigh ? '#e74c3c' : '#27ae60'}; color:#fff;">${d.name} <br>Avg: ${d.average.toFixed(2)} (P: ${(d.percentile*100).toFixed(0)}%)</span>`;
            });
        }

        area.innerHTML = html;
    }
};

// --- Page 6: Sandbox ---
App.Sandbox = {
    mods: new Map(),

    init() {
        this.mods.clear();
        const wSel = document.getElementById('p6-worker-select');
        wSel.innerHTML = '<option value="">-- Select Worker --</option>';
        App.Data.problem.workers.forEach((w, i) => {
            wSel.innerHTML += `<option value="${i}">${w.name} (Cur: Opt #${App.Data.bestSol[i]})</option>`;
        });
        this.updateUI();
        this.evaluateAndRender();
    },

    updateUI() {
        const wIdxStr = document.getElementById('p6-worker-select').value;
        const rSel = document.getElementById('p6-rota-select');
        rSel.innerHTML = '';
        if (wIdxStr === '') return;
        const wIdx = parseInt(wIdxStr, 10);
        App.Data.problem.workers[wIdx].available_rotas.forEach((r, i) => {
            rSel.innerHTML += `<option value="${i}">Option #${i} (Pref ${r.preference_rank})</option>`;
        });
        rSel.value = this.mods.has(wIdx) ? this.mods.get(wIdx) : App.Data.bestSol[wIdx];
    },

    addMod() {
        const wIdxStr = document.getElementById('p6-worker-select').value;
        if (wIdxStr === '') return alert('Select a worker.');
        const wIdx = parseInt(wIdxStr, 10);
        const rIdx = parseInt(document.getElementById('p6-rota-select').value, 10);
        this.mods.set(wIdx, rIdx);
        this.evaluateAndRender();
    },

    updateTableMod(wIdx, newRIdx) {
        this.mods.set(parseInt(wIdx, 10), parseInt(newRIdx, 10));
        this.evaluateAndRender();
    },

    removeMod(wIdx) {
        this.mods.delete(parseInt(wIdx, 10));
        this.evaluateAndRender();
        this.updateUI();
    },

    reset() {
        this.mods.clear();
        this.evaluateAndRender();
        this.updateUI();
    },

    evaluateAndRender() {
        let modSol = [...App.Data.bestSol];
        let isoDeltas = new Map();

        for (let [w, r] of this.mods.entries()) {
            modSol[w] = r;
            let isoSol = [...App.Data.bestSol];
            isoSol[w] = r;
            isoDeltas.set(w, App.Core.evaluate(isoSol).fitness - App.Data.bestFit);
        }

        const nFit = App.Core.evaluate(modSol).fitness;
        const cDelta = nFit - App.Data.bestFit;

        document.getElementById('p6-base-fit').textContent = App.Data.bestFit.toFixed(4);
        document.getElementById('p6-mod-fit').textContent = nFit.toFixed(4);
        document.getElementById('p6-fit-delta').textContent = (cDelta >= 0 ? '+' : '') + cDelta.toFixed(4);
        document.getElementById('p6-fit-delta').style.color = cDelta >= 0 ? '#27ae60' : '#c0392b';

        const tb = document.getElementById('p6-mods-body');
        tb.innerHTML = '';
        if (this.mods.size === 0) {
            tb.innerHTML = '<tr><td colspan="5">No manual modifications active.</td></tr>';
            return;
        }

        for (let [w, r] of this.mods.entries()) {
            let isoD = isoDeltas.get(w);
            let color = isoD >= 0 ? '#27ae60' : '#c0392b';
            let isoText = `<span style="color: ${color}; font-weight: bold;">${(isoD >= 0 ? '+' : '') + isoD.toFixed(4)}</span>`;

            let optionsHtml = App.Data.problem.workers[w].available_rotas.map((rota, idx) =>
                `<option value="${idx}" ${idx === r ? 'selected' : ''}>Opt #${idx}</option>`
            ).join('');

            tb.innerHTML += `<tr>
                <td>Worker #${w}</td>
                <td>Opt #${App.Data.bestSol[w]}</td>
                <td><select style="padding: 4px; margin: 0;" onchange="App.Sandbox.updateTableMod(${w}, this.value)">${optionsHtml}</select></td>
                <td>${isoText}</td>
                <td><button class="action-btn" onclick="App.Sandbox.removeMod(${w})" style="padding: 2px 8px; font-size: 11px; background: #c0392b;">Remove</button></td>
            </tr>`;
        }
    }
};

// --- Page 7: Leave Simulator ---
App.Leave = {
    reasons: [
        "Food Poisoning",
        "Severe Migraine",
        "Car Broke Down",
        "Family Emergency",
        "Norovirus / Diarrhoea",
        "Boiler Leaking at Home",
        "Jury Duty",
        "Sprained Ankle"
    ],

    simulate() {
        if (!App.Data.bestSol || !App.Data.problem) {
            return alert("Please run the solver first to generate a baseline solution.");
        }

        const workers = App.Data.problem.workers;

        // Filter out workers who only have 1 rota option
        const eligibleWorkers = workers.filter(w => w.available_rotas.length > 1);
        if (eligibleWorkers.length === 0) {
            return alert("No workers have multiple rota options available for simulation.");
        }

        // Randomly select an eligible worker and a reason
        const worker = eligibleWorkers[Math.floor(Math.random() * eligibleWorkers.length)];
        const wIdx = worker.index;
        const reason = this.reasons[Math.floor(Math.random() * this.reasons.length)];

        const currentRIdx = App.Data.bestSol[wIdx];
        const currentRota = worker.available_rotas[currentRIdx];
        const baseFit = App.Data.bestFit;

        // Populate the UI with the incident details
        document.getElementById('p7-worker-name').textContent = `${worker.name} (${worker.worker_id})`;
        document.getElementById('p7-reason').textContent = reason;
        document.getElementById('p7-current-rota').textContent = `Option #${currentRIdx} (${currentRota.rota_id})`;
        document.getElementById('p7-base-fit').textContent = baseFit.toFixed(4);

        const tbody = document.getElementById('p7-alternatives-body');
        tbody.innerHTML = '';

        let alternativesFound = false;

        // Evaluate all OTHER available rotas for this specific worker
        worker.available_rotas.forEach((rota, idx) => {
            if (idx === currentRIdx) return;
            alternativesFound = true;

            let tempSol = [...App.Data.bestSol];
            tempSol[wIdx] = idx;

            let newFit = App.Core.evaluate(tempSol).fitness;
            let delta = newFit - baseFit;

            let color = delta >= 0 ? '#27ae60' : '#c0392b';
            let sign = delta >= 0 ? '+' : '';

            tbody.innerHTML += `<tr>
                <td>Option #${idx} (${rota.rota_id})</td>
                <td>${rota.preference_rank}</td>
                <td>${newFit.toFixed(4)}</td>
                <td style="color: ${color}; font-weight: bold;">${sign}${delta.toFixed(4)}</td>
            </tr>`;
        });

        if (!alternativesFound) {
            tbody.innerHTML = '<tr><td colspan="4">No alternative rotas available for this worker.</td></tr>';
        }

        document.getElementById('p7-results').style.display = 'block';
    }
};