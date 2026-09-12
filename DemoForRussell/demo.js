// Global State Context
let ProblemContext = null;
let ReferencePopulation = [];
let GlobalProxyData = [];
let BestSolution = null;
let BestFitness = -Infinity;

let LinkageMatrix = null;
let RawLinkageMatrix = null;
let MinedPartialSolutions = [];
let ActiveMetrics = [];
let ActiveModifications = new Map();
let ComparedWorkers = [];

const metricNames = {
    'mean_fitness': 'Mean Fitness', 'mwu': 'MWU Test P-Value', 'mwu_thresh': 'MWU Test (Threshold)',
    'weighted_var': 'Weighted Variance', 'atomicity': 'Atomicity', 'a_plus_i': 'Atomicity + Independence',
    'star_count': 'Star-count', 'inverse_star_count': 'Inverse Star Count', 'independence': 'Independence',
    'robustness': 'Robustness', 'sample_count': 'Sample Count', 'inverse_sample_count': 'Inverse Sample Count'
};

window.addEventListener('DOMContentLoaded', () => {
    fetch('MartinsInstance.json')
        .then(res => res.json())
        .then(data => {
            ProblemContext = data;
            ProblemContext.skillMap = {};
            ProblemContext.skills.forEach(s => ProblemContext.skillMap[s] = []);
            ProblemContext.workers.forEach((w, idx) => {
                w.skills.forEach(s => {
                    if (ProblemContext.skillMap[s]) ProblemContext.skillMap[s].push(idx);
                });
            });
            document.getElementById('p1-progress').textContent = "Martin's Instance Data loaded. Ready to run.";
        })
        .catch(err => {
            document.getElementById('p1-progress').textContent = "Failed to load MartinsInstance.json: " + err.message;
        });
});

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    const content = document.getElementById(tabId);
    if (content) content.classList.add('active');

    const btn = document.querySelector(`.tab-btn[onclick="switchTab('${tabId}')"]`);
    if (btn) btn.classList.add('active');

    if (tabId === 'page2' && BestSolution) updatePage2Viewer();
    if (tabId === 'page6' && BestSolution) initPage6Sandbox();
}

function clearAllDescriptors() {
    document.querySelectorAll('[id^="desc-"]').forEach(el => el.innerHTML = '');
}

// --- Fitness Calculation & Proxy Grid Expansion ---
function calculateRangeScore(weeklyMatrix) {
    let mins = [...weeklyMatrix[0]];
    let maxs = [...weeklyMatrix[0]];
    for (let w = 1; w < weeklyMatrix.length; w++) {
        for (let d = 0; d < 7; d++) {
            if (weeklyMatrix[w][d] < mins[d]) mins[d] = weeklyMatrix[w][d];
            if (weeklyMatrix[w][d] > maxs[d]) maxs[d] = weeklyMatrix[w][d];
        }
    }
    let scores = [];
    for (let d = 0; d < 7; d++) {
        if (maxs[d] === 0) {
            scores.push(1.0);
        } else {
            scores.push(Math.pow((maxs[d] - mins[d]) / maxs[d], 2));
        }
    }
    return { mins, maxs, scores };
}

function evaluateStaffRostering(solution) {
    let totalRangeScore = 0;
    let unlikedRotasCount = 0;
    const numWeeks = ProblemContext.calendar_length / 7;
    const chosenPatterns = [];
    let totalWorkingDays = 0;

    for (let i = 0; i < ProblemContext.workers.length; i++) {
        const rIdx = solution[i];
        const pat = ProblemContext.workers[i].available_rotas[rIdx].pattern;
        chosenPatterns.push(pat);
        totalWorkingDays += pat.filter(x => x === 1).length;
        if (rIdx !== 0) unlikedRotasCount++;
    }

    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let colPenalties = new Array(7).fill(0);
    let proxies = {
        "Total Working Days": totalWorkingDays,
        "Unpreferred Rotas": unlikedRotasCount
    };

    ProblemContext.skills.forEach(skillName => {
        const workerIndices = ProblemContext.skillMap[skillName];
        if (!workerIndices || workerIndices.length === 0) return;

        let weeklyMatrix = Array.from({ length: numWeeks }, () => new Array(7).fill(0));
        workerIndices.forEach(wIdx => {
            const pat = chosenPatterns[wIdx];
            for (let day = 0; day < ProblemContext.calendar_length; day++) {
                if (pat[day] === 1) weeklyMatrix[Math.floor(day / 7)][day % 7]++;
            }
        });

        const { scores } = calculateRangeScore(weeklyMatrix);
        let skillTotalPenalty = 0;

        for (let d = 0; d < 7; d++) {
            let penalty = scores[d] * ProblemContext.weights[d];
            skillTotalPenalty += penalty;
            colPenalties[d] += penalty;
            proxies[`Penalty: ${skillName} - ${weekdays[d]}`] = penalty;
        }
        proxies[`Penalty: ${skillName} - Total`] = skillTotalPenalty;
        totalRangeScore += skillTotalPenalty;
    });

    for (let d = 0; d < 7; d++) {
        proxies[`Penalty: All Skills - ${weekdays[d]}`] = colPenalties[d];
    }
    proxies["Total Range Penalty"] = totalRangeScore;

    const preferencePenalty = ProblemContext.rota_preference_weight * unlikedRotasCount;
    const finalFitness = -(totalRangeScore + preferencePenalty);

    return { fitness: finalFitness, proxies: proxies };
}

// --- Page 1: GA Solver ---
async function executeSolver() {
    if (!ProblemContext) return alert("Problem data not loaded yet.");
    const budget = parseInt(document.getElementById('p1-budget').value, 10);
    const popSize = parseInt(document.getElementById('p1-popsize').value, 10);
    const L = ProblemContext.workers.length;
    const searchSpace = ProblemContext.workers.map(w => w.available_rotas.length);

    ReferencePopulation = [];
    GlobalProxyData = [];
    BestFitness = -Infinity;
    BestSolution = null;

    const canvas = document.getElementById('fitnessCanvas');
    const ctx = canvas.getContext('2d');
    const log = document.getElementById('p1-log');
    let history = [];

    let pop = [];
    for (let i = 0; i < popSize; i++) {
        let sol = searchSpace.map(c => Math.floor(Math.random() * c));
        let res = evaluateStaffRostering(sol);
        pop.push({ sol, fit: res.fitness });

        res.proxies["Generation"] = 0;
        ReferencePopulation.push({ solution: [...sol], fitness: res.fitness, generation: 0 });
        GlobalProxyData.push(res.proxies);

        if (res.fitness > BestFitness) { BestFitness = res.fitness; BestSolution = [...sol]; }
    }

    let evals = popSize;
    let gen = 1;
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
                if (Math.random() < (1.0 / L)) child[j] = Math.floor(Math.random() * searchSpace[j]);
            }

            let res = evaluateStaffRostering(child);
            evals++;
            children.push({ sol: child, fit: res.fitness });

            res.proxies["Generation"] = gen;
            ReferencePopulation.push({ solution: [...child], fitness: res.fitness, generation: gen });
            GlobalProxyData.push(res.proxies);

            if (res.fitness > BestFitness) { BestFitness = res.fitness; BestSolution = [...child]; }
        }

        pop = pop.concat(children);
        pop.sort((a, b) => b.fit - a.fit);
        pop = pop.slice(0, popSize);
        history.push(BestFitness);
        gen++;

        if (gen % 5 === 0) {
            ctx.clearRect(0,0,canvas.width,canvas.height);
            ctx.beginPath();
            ctx.strokeStyle = '#3498db';
            let minF = Math.min(...history), maxF = Math.max(...history);
            let range = maxF - minF || 1;
            history.forEach((f, i) => {
                let x = (i / history.length) * canvas.width;
                let y = canvas.height - ((f - minF) / range) * canvas.height;
                if (i===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            document.getElementById('p1-progress').textContent = `Evaluations: ${evals}/${budget}`;
            await new Promise(r => setTimeout(r, 0));
        }
    }
    log.textContent += `Run completed successfully. Total Generations: ${gen}\nBest Fitness Found: ${BestFitness.toFixed(5)}\nGenerated ${ReferencePopulation.length} PRef entries with Proxy data.`;
}

// --- Page 2: Viewer & Comparison ---
function updatePage2Viewer() {
    if (!BestSolution) return;
    document.getElementById('p2-fit-summary').textContent = `Best Fitness: ${BestFitness.toFixed(5)}`;
    const numWeeks = ProblemContext.calendar_length / 7;

    document.getElementById('p2-skill-matrix-head').innerHTML = '<tr><th>Skill</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Sun</th><th>Total Score</th></tr>';
    const mBody = document.getElementById('p2-skill-matrix-body');
    mBody.innerHTML = '';

    ProblemContext.skills.forEach(skill => {
        const wIndices = ProblemContext.skillMap[skill] || [];
        let weeklyMatrix = Array.from({ length: numWeeks }, () => new Array(7).fill(0));
        wIndices.forEach(idx => {
            const pat = ProblemContext.workers[idx].available_rotas[BestSolution[idx]].pattern;
            for (let day = 0; day < ProblemContext.calendar_length; day++) {
                if (pat[day] === 1) weeklyMatrix[Math.floor(day/7)][day%7]++;
            }
        });

        const { mins, maxs, scores } = calculateRangeScore(weeklyMatrix);
        let tr = `<tr><td><strong>${skill}</strong></td>`;
        let total = 0;
        for (let d = 0; d < 7; d++) {
            let s = scores[d] * ProblemContext.weights[d];
            total += s;
            let color = `hsl(${(1 - scores[d]) * 120}, 70%, 80%)`;
            tr += `<td style="background-color: ${color}">${mins[d]} - ${maxs[d]}<br>(${scores[d].toFixed(2)})</td>`;
        }
        tr += `<td><strong>${total.toFixed(4)}</strong></td></tr>`;
        mBody.innerHTML += tr;
    });

    let dHead = '<tr><th>Day</th>';
    ProblemContext.skills.forEach(s => dHead += `<th>${s.replace('SKILL_', 'S_')}</th>`);
    dHead += '</tr>';
    document.getElementById('p2-daily-head').innerHTML = dHead;

    let dBody = '';
    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (let day = 0; day < ProblemContext.calendar_length; day++) {
        dBody += `<tr><td>${day+1} (${weekdays[day%7]})</td>`;
        ProblemContext.skills.forEach(skill => {
            let count = 0;
            const wIndices = ProblemContext.skillMap[skill] || [];
            wIndices.forEach(idx => {
                if (ProblemContext.workers[idx].available_rotas[BestSolution[idx]].pattern[day] === 1) count++;
            });
            dBody += `<td>${count}</td>`;
        });
        dBody += `</tr>`;
    }
    document.getElementById('p2-daily-body').innerHTML = dBody;

    const empBody = document.getElementById('p2-emp-table-body');
    empBody.innerHTML = '';

    const compSel = document.getElementById('p2-compare-select');
    compSel.innerHTML = '';

    ProblemContext.workers.forEach((w, idx) => {
        const rIdx = BestSolution[idx];
        const rObj = w.available_rotas[rIdx];
        empBody.innerHTML += `<tr><td>${w.worker_id}</td><td>Opt #${rIdx}</td><td>${rObj.preference_rank}</td><td>${w.skills.join(', ')}</td></tr>`;
        compSel.innerHTML += `<option value="${idx}">${w.name} (Opt #${rIdx})</option>`;
    });

    renderRotaComparison();
}

function addRotaToCompare() {
    const wIdx = parseInt(document.getElementById('p2-compare-select').value, 10);
    if (!ComparedWorkers.includes(wIdx)) {
        ComparedWorkers.push(wIdx);
        renderRotaComparison();
    }
}

function clearRotaComparison() {
    ComparedWorkers = [];
    renderRotaComparison();
}

function renderRotaComparison() {
    const head = document.getElementById('p2-compare-head');
    const body = document.getElementById('p2-compare-body');

    if (ComparedWorkers.length === 0) {
        head.innerHTML = '<tr><th>Day</th><th>Weekday</th></tr>';
        body.innerHTML = '<tr><td colspan="2">Select workers to compare their assigned rotas.</td></tr>';
        return;
    }

    let hHtml = '<tr><th>Day</th><th>Weekday</th>';
    ComparedWorkers.forEach(wIdx => {
        hHtml += `<th>${ProblemContext.workers[wIdx].name} (Opt #${BestSolution[wIdx]})</th>`;
    });
    hHtml += '</tr>';
    head.innerHTML = hHtml;

    let bHtml = '';
    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for(let d = 0; d < ProblemContext.calendar_length; d++) {
        bHtml += `<tr><td>${d+1}</td><td>${weekdays[d%7]}</td>`;
        ComparedWorkers.forEach(wIdx => {
            const rIdx = BestSolution[wIdx];
            const isWorking = ProblemContext.workers[wIdx].available_rotas[rIdx].pattern[d] === 1;
            bHtml += `<td style="background-color: ${isWorking ? '#27ae60' : '#ebedef'}; color: ${isWorking ? '#fff' : '#333'}; text-align: center; font-weight: bold;">${isWorking ? 'Work' : 'Off'}</td>`;
        });
        bHtml += '</tr>';
    }
    body.innerHTML = bHtml;
}

// --- Page 3: Linkage ---
async function computePerturbationLinkage() {
    if (!BestSolution) throw new Error("No Best Solution found. Run solver first.");
    const L = ProblemContext.workers.length;
    const matrix = Array.from({length: L}, () => new Array(L).fill(0));

    const effects1D = Array.from({length: L}, () => ({}));
    const baseFit = evaluateStaffRostering(BestSolution).fitness;

    for (let i = 0; i < L; i++) {
        const numOpts = ProblemContext.workers[i].available_rotas.length;
        const baseOpt = BestSolution[i];
        for (let v = 0; v < numOpts; v++) {
            if (v !== baseOpt) {
                let sol = [...BestSolution];
                sol[i] = v;
                effects1D[i][v] = evaluateStaffRostering(sol).fitness - baseFit;
            } else {
                effects1D[i][v] = 0;
            }
        }
    }

    let totalPairs = (L * (L - 1)) / 2;
    let pairsDone = 0;

    for (let i = 0; i < L; i++) {
        const numOptsI = ProblemContext.workers[i].available_rotas.length;
        const baseOptI = BestSolution[i];

        for (let j = i + 1; j < L; j++) {
            const numOptsJ = ProblemContext.workers[j].available_rotas.length;
            const baseOptJ = BestSolution[j];

            if (numOptsI <= 1 || numOptsJ <= 1) {
                matrix[i][j] = 0;
                matrix[j][i] = 0;
            } else {
                let sum = 0;
                let count = 0;

                for (let vi = 0; vi < numOptsI; vi++) {
                    if (vi === baseOptI) continue;
                    for (let vj = 0; vj < numOptsJ; vj++) {
                        if (vj === baseOptJ) continue;

                        let sol = [...BestSolution];
                        sol[i] = vi;
                        sol[j] = vj;

                        let fit2D = evaluateStaffRostering(sol).fitness;
                        let delta2D = fit2D - baseFit;
                        let expectedDelta = effects1D[i][vi] + effects1D[j][vj];

                        let interaction = Math.abs(delta2D - expectedDelta);
                        sum += interaction;
                        count++;
                    }
                }
                matrix[i][j] = count > 0 ? (sum / count) : 0;
                matrix[j][i] = matrix[i][j];
            }

            pairsDone++;
            if (pairsDone % 500 === 0) {
                document.getElementById('p3-status').textContent = `Calculating Perturbation: ${pairsDone} / ${totalPairs} pairs...`;
                await new Promise(r => setTimeout(r, 0));
            }
        }
    }

    return matrix;
}

async function executeLinkageCalculation() {
    if (ReferencePopulation.length === 0) return alert("Run solver first.");
    const method = document.getElementById('p3-method').value;
    document.getElementById('p3-status').textContent = "Calculating Linkage...";
    await new Promise(r => setTimeout(r, 20));

    const L = ProblemContext.workers.length;
    let raw;

    if (method === 'perturbation') {
        try {
            raw = await computePerturbationLinkage();
        } catch(e) {
            alert(e.message);
            return;
        }
    } else {
        const sols = ReferencePopulation.map(p => p.solution);
        const fits = ReferencePopulation.map(p => p.fitness);
        if (method === 'dominance') raw = dominance_linkage(sols, fits);
        else if (method === 'misurvival') raw = misurvival_linkage(sols, fits);
        else raw = traditional_mutual_information(sols, fits);
    }

    RawLinkageMatrix = Array.from({length: L}, () => new Array(L).fill(0));
    LinkageMatrix = Array.from({length: L}, () => new Array(L).fill(0));

    for (let i = 0; i < L; i++) {
        for (let j = 0; j < L; j++) {
            let v = raw[i][j];
            let num = (v === "" || v === undefined || isNaN(v)) ? 0 : Number(v);
            RawLinkageMatrix[i][j] = num;
            LinkageMatrix[i][j] = num;
        }
    }

    renderMatrix();
    document.getElementById('p3-status').textContent = "Linkage Matrix calculated.";
    document.getElementById('p3-sort-btn').disabled = false;

    let wSel = document.getElementById('p3-worker-select');
    wSel.innerHTML = '<option value="">-- Select Worker --</option>';
    ProblemContext.workers.forEach((w, i) => {
        wSel.innerHTML += `<option value="${i}">${w.name} (${w.worker_id})</option>`;
    });
}

function executeGreedyReordering() {
    const L = LinkageMatrix.length;
    let unvisited = new Set(Array.from({length: L}, (_, i) => i));
    let perm = [0];
    unvisited.delete(0);

    while (unvisited.size > 0) {
        let best = -1, minD = Infinity;
        let curr = perm[perm.length - 1];
        for (let cand of unvisited) {
            let d = 0;
            for (let k = 0; k < L; k++) d += Math.abs(LinkageMatrix[curr][k] - LinkageMatrix[cand][k]);
            if (d < minD) { minD = d; best = cand; }
        }
        perm.push(best);
        unvisited.delete(best);
    }

    let minSum = Infinity;
    let minIndex = 0;
    for (let r = 0; r < L; r++) {
        let sum = 0;
        for (let c = 0; c < L; c++) sum += LinkageMatrix[perm[r]][perm[c]];
        if (sum < minSum) { minSum = sum; minIndex = r; }
    }
    let newPerm = perm.slice(minIndex).concat(perm.slice(0, minIndex));

    const reordered = Array.from({length: L}, () => new Array(L).fill(0));
    for (let r = 0; r < L; r++) {
        for (let c = 0; c < L; c++) {
            reordered[r][c] = LinkageMatrix[newPerm[r]][newPerm[c]];
        }
    }
    LinkageMatrix = reordered;
    renderMatrix();
}

function renderMatrix() {
    const canvas = document.getElementById('matrixCanvas');
    const ctx = canvas.getContext('2d');
    const L = LinkageMatrix.length;
    const s = canvas.width / L;
    let maxV = 0;
    for (let i=0; i<L; i++) for (let j=0; j<L; j++) if(LinkageMatrix[i][j] > maxV) maxV = LinkageMatrix[i][j];

    ctx.clearRect(0,0,canvas.width,canvas.height);
    for (let i=0; i<L; i++) {
        for (let j=0; j<L; j++) {
            let intensity = maxV > 0 ? (LinkageMatrix[i][j] / maxV) : 0;
            ctx.fillStyle = i === j ? '#fff' : `rgba(230, 126, 34, ${intensity})`;
            ctx.fillRect(j*s, i*s, s, s);
        }
    }
}

function showWorkerLinkages() {
    let val = document.getElementById('p3-worker-select').value;
    if (val === '') return;
    let wIdx = parseInt(val, 10);
    let linkages = [];

    for (let i = 0; i < ProblemContext.workers.length; i++) {
        if (i !== wIdx) {
            linkages.push({
                name: ProblemContext.workers[i].name,
                id: ProblemContext.workers[i].worker_id,
                score: RawLinkageMatrix[wIdx][i]
            });
        }
    }
    linkages.sort((a,b) => b.score - a.score);

    let tbody = document.getElementById('p3-linkage-results');
    tbody.innerHTML = '';
    let rank = 1;
    linkages.forEach((l) => {
        if (l.score > 0) {
            tbody.innerHTML += `<tr><td>${rank++}</td><td>${l.name} (${l.id})</td><td>${l.score.toFixed(4)}</td></tr>`;
        }
    });
    if(tbody.innerHTML === '') {
        tbody.innerHTML = '<tr><td colspan="3">No positive linkages found.</td></tr>';
    }
}

// --- Page 4 & 5: PS Mining & Clustering ---
window.MinedDB = null;
const rawMetricLogic = {
    'mean_fitness': (fm) => fm.length > 0 ? (fm.reduce((a,b)=>a+b,0)/fm.length) : NaN,
    'mwu': (fm, fnm) => obj_mwu_test(fm, fnm),
    'mwu_thresh': (fm, fnm) => obj_mwu_test_threshold(fm, fnm),
    'weighted_var': (fm, fnm) => obj_weighted_variance(fm, fnm, window.MinedDB.N),
    'atomicity': (fm, fnm, ps) => RawLinkageMatrix ? -(obj_atomicity(ps, RawLinkageMatrix)) : NaN,
    'a_plus_i': (fm, fnm, ps) => RawLinkageMatrix ? -(obj_a_plus_i(ps, RawLinkageMatrix)) : NaN,
    'star_count': (fm, fnm, ps) => -(obj_star_count(ps)),
    'inverse_star_count': (fm, fnm, ps) => obj_inverse_star_count(ps),
    'independence': (fm, fnm, ps) => RawLinkageMatrix ? obj_independence(ps, RawLinkageMatrix) : NaN,
    'robustness': (fm) => fm.length > 0 ? Math.min(...fm) : NaN,
    'sample_count': (fm) => fm.length,
    'inverse_sample_count': (fm) => -fm.length
};

async function executePSMining() {
    if (ReferencePopulation.length === 0) return alert("Run solver first.");
    ActiveMetrics = Array.from(document.querySelectorAll('#p4-obj-list input:checked')).map(cb => cb.value);
    if (ActiveMetrics.length === 0) return alert("Select at least one metric.");

    window.MinedDB = new PRefDatabase(ReferencePopulation.map(p => p.solution), ReferencePopulation.map(p => p.fitness));
    const db = window.MinedDB;
    const L = ProblemContext.workers.length;

    const objLogic = {
        'mean_fitness': (fm) => obj_mean_fitness(fm),
        'mwu': (fm, fnm) => obj_mwu_test(fm, fnm),
        'mwu_thresh': (fm, fnm) => obj_mwu_test_threshold(fm, fnm),
        'weighted_var': (fm, fnm) => obj_weighted_variance(fm, fnm, db.N),
        'atomicity': (fm, fnm, ps) => RawLinkageMatrix ? obj_atomicity(ps, RawLinkageMatrix) : 0,
        'a_plus_i': (fm, fnm, ps) => RawLinkageMatrix ? obj_a_plus_i(ps, RawLinkageMatrix) : 0,
        'star_count': (fm, fnm, ps) => obj_star_count(ps),
        'inverse_star_count': (fm, fnm, ps) => obj_inverse_star_count(ps),
        'independence': (fm, fnm, ps) => RawLinkageMatrix ? obj_independence(ps, RawLinkageMatrix) : 0,
        'robustness': (fm) => obj_robustness(fm),
        'sample_count': (fm) => obj_sample_count(fm),
        'inverse_sample_count': (fm) => obj_inverse_sample_count(fm)
    };

    let objFuncs = [];
    ActiveMetrics.forEach(id => {
        objFuncs.push(ps => {
            let { matchIndices, notMatchIndices } = db.getMatches(ps);
            let { fMatch, fNotMatch } = db.getFitnessArrays(matchIndices, notMatchIndices);
            let v = objLogic[id](fMatch, fNotMatch, ps);
            return (isNaN(v) || v === null) ? Infinity : v;
        });
    });

    const budget = parseInt(document.getElementById('p4-budget').value, 10);
    const popSize = parseInt(document.getElementById('p4-popsize').value, 10);
    const scope = document.getElementById('p4-scope').value;

    const searchSpace = ProblemContext.workers.map(w => w.available_rotas.length);
    let operators = scope === 'global' ?
        { sample: () => OperatorsGlobal.sample(L, searchSpace), mutate: (ps) => OperatorsGlobal.mutate(ps, L, searchSpace) } :
        { sample: () => OperatorsLocal.sample(L, BestSolution), mutate: (ps) => OperatorsLocal.mutate(ps, L, BestSolution) };

    document.getElementById('p4-status').textContent = "Running NSGA-II...";
    const nsga = new PS_NSGAII(L, searchSpace, objFuncs, budget, popSize, operators);

    let res = await nsga.run();

    MinedPartialSolutions = res.map(ind => {
        let { matchIndices, notMatchIndices } = db.getMatches(ind.ps);
        let { fMatch, fNotMatch } = db.getFitnessArrays(matchIndices, notMatchIndices);

        let metrics = {};
        ActiveMetrics.forEach((id, index) => {
            let readableVal = rawMetricLogic[id](fMatch, fNotMatch, ind.ps);
            metrics[id] = { name: metricNames[id], val: readableVal, nsga_min: ind.objectives[index] };
        });

        return {
            ps: ind.ps,
            fixed: ind.ps.filter(x => x !== -1).length,
            samples: fMatch.length,
            metrics: metrics,
            zSum: ind.z_sum
        };
    });

    const sortSel = document.getElementById('p5-sort');
    sortSel.innerHTML = '<option value="minimax">Minimax Regret</option>';
    ActiveMetrics.forEach(id => {
        sortSel.innerHTML += `<option value="${id}">${metricNames[id]}</option>`;
    });

    document.getElementById('p4-status').textContent = `Done. Found ${MinedPartialSolutions.length} non-dominated patterns.`;
    renderPSCards();
    switchTab('page5');
}

function renderPSCards() {
    const container = document.getElementById('p5-container');
    if (!MinedPartialSolutions || MinedPartialSolutions.length === 0) {
        container.innerHTML = "No Partial Solutions discovered yet.";
        return;
    }

    let items = [...MinedPartialSolutions];
    const sortBy = document.getElementById('p5-sort').value;
    const doCluster = document.getElementById('p5-cluster').checked;

    if (sortBy === 'minimax') {
        items.sort((a, b) => a.zSum - b.zSum);
    } else {
        items.sort((a, b) => a.metrics[sortBy].nsga_min - b.metrics[sortBy].nsga_min);
    }

    if (doCluster && items.length > 2) {
        let clusters = [];
        for (let item of items) {
            let matched = false;
            for (let c of clusters) {
                let diff = 0;
                for (let i = 0; i < item.ps.length; i++) {
                    if (item.ps[i] !== c.centroid.ps[i]) diff++;
                }
                if (diff < item.ps.length * 0.15) {
                    c.members.push(item);
                    matched = true;
                    break;
                }
            }
            if (!matched) clusters.push({ centroid: item, members: [item] });
        }
        items = clusters.map(c => c.centroid);
    }

    container.innerHTML = '';
    items.forEach((item, idx) => {
        let rules = [];
        for(let j=0; j<item.ps.length; j++) {
            if(item.ps[j] !== -1) rules.push(`Worker #${j} -> Option #${item.ps[j]}`);
        }

        let metricHtml = `<span class="ps-tag" style="background:#27ae60; color:#fff;">Matches: ${item.samples}</span>`;
        ActiveMetrics.forEach(id => {
            let v = item.metrics[id].val;
            let displayValue = (id.includes('mwu') ? v.toExponential(3) : v.toFixed(4));
            if (id.includes('count')) displayValue = Math.abs(v).toString();
            metricHtml += `<span class="ps-tag">${metricNames[id]}: ${displayValue}</span>`;
        });

        container.innerHTML += `
            <div class="ps-card">
                <div class="ps-title" onclick="toggleAccordion('ps-rules-${idx}')">
                    Partial Solution ${idx + 1} (${item.fixed} Fixed Workers) <span style="font-weight:normal;">▼ Click to expand</span>
                </div>
                <div style="margin: 8px 0;">${metricHtml}</div>
                <div id="ps-rules-${idx}" class="ps-rules-content">
                    <strong>Fixed Assignments:</strong><br>
                    ${rules.join('<br>')}
                </div>
                <div style="margin-top:10px;">
                    <button class="action-btn" onclick="showDescriptors(${idx})">Calculate Descriptors</button>
                    <div id="desc-${idx}" style="margin-top: 10px;"></div>
                </div>
            </div>`;
    });
}

function toggleAccordion(id) {
    document.querySelectorAll('.ps-rules-content').forEach(el => {
        if(el.id !== id) el.classList.remove('expanded');
    });
    document.getElementById(id).classList.toggle('expanded');
}

function showDescriptors(uiIndex) {
    if (!window.MinedDB || GlobalProxyData.length === 0) return alert("Proxy Data missing.");
    let threshold = parseFloat(document.getElementById('desc-threshold').value) || 0.1;
    let isLocal = document.getElementById('desc-ref').value === 'local';
    let targetSol = isLocal ? BestSolution : null;

    let item = MinedPartialSolutions[uiIndex];
    let area = document.getElementById(`desc-${uiIndex}`);

    let descriptors = calculate_descriptors(item.ps, window.MinedDB, GlobalProxyData, threshold, 1000, targetSol);

    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let gridDescriptors = [];
    let otherDescriptors = [];

    descriptors.forEach(d => {
        let match = d.name.match(/^Penalty:\s+(.+?)\s+-\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
        if (match && match[1] !== "All Skills") {
            gridDescriptors.push({ ...d, skill: match[1], day: match[2] });
        } else {
            otherDescriptors.push(d);
        }
    });

    let html = `<strong>Extreme Descriptors (Threshold ${(threshold * 100).toFixed(0)}%):</strong><br>`;

    if (gridDescriptors.length > 3) {
        let skillsSet = new Set(gridDescriptors.map(g => g.skill));
        let skillsArr = Array.from(skillsSet).sort();

        let tableHtml = `<table class="data-table" style="margin-top: 10px; margin-bottom: 10px;"><thead><tr><th>Skill</th>`;
        weekdays.forEach(day => tableHtml += `<th>${day}</th>`);
        tableHtml += `</tr></thead><tbody>`;

        skillsArr.forEach(skill => {
            tableHtml += `<tr><td><strong>${skill}</strong></td>`;
            weekdays.forEach(day => {
                let cellData = gridDescriptors.find(g => g.skill === skill && g.day === day);
                if (cellData) {
                    let isHigh = cellData.percentile > 0.5;
                    let color = isHigh ? "#e74c3c" : "#27ae60";
                    let label = isHigh ? "HIGH" : "LOW";
                    tableHtml += `<td style="color: ${color}; font-weight: bold; font-size: 11px; text-align: center;">${label}<br><span style="color: #333; font-weight: normal;">Avg: ${cellData.average.toFixed(2)}</span></td>`;
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

    if (otherDescriptors.length === 0 && gridDescriptors.length <= 3 && descriptors.length === 0) {
        html += `<em>No descriptors passed the ECDF extremity threshold.</em>`;
    } else {
        otherDescriptors.forEach(d => {
            html += `<span class="ps-tag" style="background:#8e44ad; color:#fff;">${d.name} <br>Avg: ${d.average.toFixed(2)} (P: ${(d.percentile*100).toFixed(1)}%)</span>`;
        });
    }

    area.innerHTML = html;
}

// --- Page 6: Solution Mod Sandbox ---
function initPage6Sandbox() {
    const sel = document.getElementById('p6-worker-select');
    sel.innerHTML = '';
    ProblemContext.workers.forEach((w, i) => {
        sel.innerHTML += `<option value="${i}">${w.name} (Cur: Opt #${BestSolution[i]})</option>`;
    });
    updateWorkerModificationUI();
    recalculateModifiedFitness();
}

function updateWorkerModificationUI() {
    const wIdx = document.getElementById('p6-worker-select').value;
    const rSel = document.getElementById('p6-rota-select');
    rSel.innerHTML = '';
    ProblemContext.workers[wIdx].available_rotas.forEach((r, i) => {
        rSel.innerHTML += `<option value="${i}">Option #${i} (Pref ${r.preference_rank})</option>`;
    });
    rSel.value = ActiveModifications.has(wIdx) ? ActiveModifications.get(wIdx) : BestSolution[wIdx];
}

function applyModification() {
    const wIdx = parseInt(document.getElementById('p6-worker-select').value, 10);
    const rIdx = parseInt(document.getElementById('p6-rota-select').value, 10);
    if (rIdx === BestSolution[wIdx]) ActiveModifications.delete(wIdx);
    else ActiveModifications.set(wIdx, rIdx);
    recalculateModifiedFitness();
    updateWorkerModificationUI();
}

function removeModification(wIdx) {
    ActiveModifications.delete(wIdx);
    recalculateModifiedFitness();
    updateWorkerModificationUI();
}

function resetModifications() {
    ActiveModifications.clear();
    recalculateModifiedFitness();
    updateWorkerModificationUI();
}

function recalculateModifiedFitness() {
    let modSol = [...BestSolution];
    let isolatedDeltas = new Map();

    for (let [w, r] of ActiveModifications.entries()) {
        modSol[w] = r;

        let isoSol = [...BestSolution];
        isoSol[w] = r;
        let isoFit = evaluateStaffRostering(isoSol).fitness;
        isolatedDeltas.set(w, isoFit - BestFitness);
    }

    const res = evaluateStaffRostering(modSol);
    const nFit = res.fitness;
    const compoundDelta = nFit - BestFitness;

    document.getElementById('p6-base-fit').textContent = BestFitness.toFixed(4);
    document.getElementById('p6-mod-fit').textContent = nFit.toFixed(4);
    document.getElementById('p6-fit-delta').textContent = (compoundDelta >= 0 ? '+' : '') + compoundDelta.toFixed(4);
    document.getElementById('p6-fit-delta').style.color = compoundDelta >= 0 ? '#27ae60' : '#c0392b';

    const tb = document.getElementById('p6-mods-body');
    tb.innerHTML = '';
    if (ActiveModifications.size === 0) {
        tb.innerHTML = '<tr><td colspan="5">No manual modifications active.</td></tr>';
        return;
    }
    for (let [w, r] of ActiveModifications.entries()) {
        let isoD = isolatedDeltas.get(w);
        let color = isoD >= 0 ? '#27ae60' : '#c0392b';
        let isoText = `<span style="color: ${color}; font-weight: bold;">${(isoD >= 0 ? '+' : '') + isoD.toFixed(4)}</span>`;

        tb.innerHTML += `<tr>
            <td>Worker #${w}</td>
            <td>Opt #${BestSolution[w]}</td>
            <td>Opt #${r}</td>
            <td>${isoText}</td>
            <td><button class="action-btn" onclick="removeModification(${w})" style="padding: 2px 8px; font-size: 11px; background: #c0392b;">Revert</button></td>
        </tr>`;
    }
}