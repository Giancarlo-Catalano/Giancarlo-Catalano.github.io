// PS_objectives.js

/**
 * Handles fast matching of Partial Solutions against the Reference Population
 * using an inverted index (set intersection) methodology.
 */
class PRefDatabase {
    constructor(solutions, fitnesses) {
        this.solutions = solutions;
        this.fitnesses = fitnesses;
        this.N = solutions.length;
        this.L = this.N > 0 ? solutions[0].length : 0;

        // Map of "variableIndex_value" to Set of solution indices
        this.precomputed_indices = new Map();

        for (let i = 0; i < this.N; i++) {
            for (let j = 0; j < this.L; j++) {
                let val = solutions[i][j];
                let key = `${j}_${val}`;
                if (!this.precomputed_indices.has(key)) {
                    this.precomputed_indices.set(key, new Set());
                }
                this.precomputed_indices.get(key).add(i);
            }
        }
    }

    /**
     * Returns an object containing { matchIndices, notMatchIndices }
     * ps is an array of numbers, where -1 represents a wildcard '*'
     */
    getMatches(ps) {
        let sets_to_intersect = [];
        let empty_ps = true;

        for (let varIdx = 0; varIdx < ps.length; varIdx++) {
            let val = ps[varIdx];
            if (val !== -1) {
                empty_ps = false;
                let key = `${varIdx}_${val}`;
                if (this.precomputed_indices.has(key)) {
                    sets_to_intersect.push(this.precomputed_indices.get(key));
                } else {
                    // Feature doesn't exist in any solution, intersection is empty
                    return { matchIndices: new Set(), notMatchIndices: new Set(Array.from({length: this.N}, (_, i) => i)) };
                }
            }
        }

        let matchIndices;
        if (empty_ps) {
            matchIndices = new Set(Array.from({length: this.N}, (_, i) => i));
        } else {
            // Sort by size for optimized intersection
            sets_to_intersect.sort((a, b) => a.size - b.size);
            matchIndices = new Set(sets_to_intersect[0]);

            for (let i = 1; i < sets_to_intersect.length; i++) {
                let current_set = sets_to_intersect[i];
                for (let item of matchIndices) {
                    if (!current_set.has(item)) {
                        matchIndices.delete(item);
                    }
                }
            }
        }

        let notMatchIndices = new Set();
        for (let i = 0; i < this.N; i++) {
            if (!matchIndices.has(i)) notMatchIndices.add(i);
        }

        return { matchIndices, notMatchIndices };
    }

    getFitnessArrays(matchIndices, notMatchIndices) {
        let fMatch = Array.from(matchIndices).map(idx => this.fitnesses[idx]);
        let fNotMatch = Array.from(notMatchIndices).map(idx => this.fitnesses[idx]);
        return { fMatch, fNotMatch };
    }
}

// --- Statistical & Utility Functions ---

function calculateVariance(arr) {
    if (arr.length <= 1) return 0;
    let mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    let sumSq = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0);
    return sumSq / arr.length; // Population variance
}

function normalCDF(x) {
    let t = 1 / (1 + 0.2316419 * Math.abs(x));
    let d = 0.3989423 * Math.exp(-x * x / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
}

function mannWhitneyU(group1, group2) {
    let n1 = group1.length, n2 = group2.length;
    if (n1 === 0 || n2 === 0) return 1.0;

    let combined = [];
    group1.forEach(v => combined.push({val: v, g: 1}));
    group2.forEach(v => combined.push({val: v, g: 2}));
    combined.sort((a, b) => a.val - b.val);

    let R1 = 0;
    let n = combined.length;

    // Assign ranks handling ties
    for(let i = 0; i < n;) {
        let j = i;
        while(j < n && combined[j].val === combined[i].val) j++;
        let avgRank = (i + j + 1) / 2;
        for(let k = i; k < j; k++) {
            if(combined[k].g === 1) R1 += avgRank;
        }
        i = j;
    }

    let U1 = R1 - (n1 * (n1 + 1)) / 2;
    let U2 = n1 * n2 - U1;
    let U = Math.min(U1, U2);

    let muU = (n1 * n2) / 2;
    let sigmaU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);

    if (sigmaU === 0) return 1.0;

    let Z = (U - muU) / sigmaU;
    return normalCDF(Z); // Using normal approximation for p-value
}


// --- 1. Fitness Quality Objectives ---

function obj_mean_fitness(fMatch) {
    if (fMatch.length === 0) return Infinity; // Return +Inf because we minimize
    let avg = fMatch.reduce((a, b) => a + b, 0) / fMatch.length;
    return -avg; // Inverted
}

function obj_mwu_test(fMatch, fNotMatch) {
    return mannWhitneyU(fMatch, fNotMatch);
}

function obj_mwu_test_threshold(fMatch, fNotMatch) {
    let p = mannWhitneyU(fMatch, fNotMatch);
    return p > 0.05 ? p : 0.05;
}

function obj_weighted_variance(fMatch, fNotMatch, N) {
    let varMatch = calculateVariance(fMatch);
    let varNotMatch = calculateVariance(fNotMatch);
    return (fMatch.length / N) * varMatch + (fNotMatch.length / N) * varNotMatch;
}

// --- 2. Atomicity Objectives ---

function obj_atomicity(ps, linkage_table) {
    let non_wildcards = [];
    for(let i=0; i<ps.length; i++) if(ps[i] !== -1) non_wildcards.push(i);

    if (non_wildcards.length < 2) return 0;

    let least_of_each_row = [];
    for(let i of non_wildcards) {
        let min_val = Infinity;
        for(let j of non_wildcards) {
            if (i === j) continue;
            let val = linkage_table[i][j];
            if (val !== "" && val !== undefined) {
                min_val = Math.min(min_val, Number(val));
            }
        }
        least_of_each_row.push(min_val === Infinity ? 0 : min_val);
    }

    let result = least_of_each_row.reduce((a,b)=>a+b, 0) / least_of_each_row.length;
    return -result; // INVERTED!
}

// --- 3. Simplicity Objectives ---

function obj_star_count(ps) {
    let count = ps.filter(x => x === -1).length;
    return -count; // Inverted
}

function obj_independence(ps, linkage_table) {
    let non_wildcards = [], wildcards = [];
    for(let i=0; i<ps.length; i++) {
        if(ps[i] !== -1) non_wildcards.push(i);
        else wildcards.push(i);
    }

    if (wildcards.length < 1 || non_wildcards.length < 1) return -1000;

    let max_of_each_wildcard_row = [];
    for(let w of wildcards) {
        let max_val = -Infinity;
        for(let n of non_wildcards) {
            let val = linkage_table[w][n];
            if (val !== "" && val !== undefined) {
                max_val = Math.max(max_val, Number(val));
            }
        }
        max_of_each_wildcard_row.push(max_val === -Infinity ? 0 : max_val);
    }

    let avg = max_of_each_wildcard_row.reduce((a,b)=>a+b, 0) / max_of_each_wildcard_row.length;
    return avg; // NOT Inverted
}

function obj_a_plus_i(ps, linkage_table) {
    return -obj_atomicity(ps, linkage_table) -obj_independence(ps, linkage_table);
}

// --- 4. Other Objectives ---

function obj_robustness(fMatch) {
    if (fMatch.length === 0) return Infinity;
    return -Math.min(...fMatch); // Invert sign of the minimum
}

function obj_sample_count(fMatch) {
    return -fMatch.length; // Inverted
}