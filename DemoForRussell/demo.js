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