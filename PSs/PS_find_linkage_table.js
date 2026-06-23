/**
 * Port of the Python paired samples hash bucket logic.
 * Uses BigInt to prevent JS float precision loss during large modulo arithmetic.
 */
function get_paired_samples_from_observations(solutions_array) {
    const N = solutions_array.length;
    if (N === 0) return [];
    const L = solutions_array[0].length;

    const base = 911382323n;
    const mod = 972663749n;

    // Precompute powers of base
    const p_pow = new Array(L + 1).fill(1n);
    for (let i = 1; i <= L; i++) {
        p_pow[i] = (p_pow[i - 1] * base) % mod;
    }

    // Prefix hashes
    const prefix_hash = Array.from({ length: N }, () => new Array(L + 1).fill(0n));
    for (let i = 0; i < N; i++) {
        for (let k = 1; k <= L; k++) {
            let val = BigInt(solutions_array[i][k - 1]);
            prefix_hash[i][k] = (prefix_hash[i][k - 1] * base + val) % mod;
        }
    }

    // Suffix hashes
    const suffix_hash = Array.from({ length: N }, () => new Array(L + 1).fill(0n));
    for (let i = 0; i < N; i++) {
        for (let k = L - 1; k >= 0; k--) {
            let val = BigInt(solutions_array[i][k]);
            suffix_hash[i][k] = (val * p_pow[L - k - 1] + suffix_hash[i][k + 1]) % mod;
        }
    }

    const result_pairs = Array.from({ length: L }, () => []);

    for (let pos = 0; pos < L; pos++) {
        const buckets = new Map();

        for (let idx = 0; idx < N; idx++) {
            let prefix = prefix_hash[idx][pos];
            let suffix = suffix_hash[idx][pos + 1];
            let combined_hash = (prefix * p_pow[L - pos - 1] + suffix) % mod;

            if (!buckets.has(combined_hash)) buckets.set(combined_hash, []);
            buckets.get(combined_hash).push(idx);
        }

        for (let idxs of buckets.values()) {
            if (idxs.length > 1) {
                for (let i = 0; i < idxs.length; i++) {
                    let index_sol_left = idxs[i];
                    let val_left = solutions_array[index_sol_left][pos];

                    for (let j = i + 1; j < idxs.length; j++) {
                        let index_sol_right = idxs[j];
                        let val_right = solutions_array[index_sol_right][pos];

                        if (val_left !== val_right) {
                            result_pairs[pos].push([index_sol_left, index_sol_right]);
                        }
                    }
                }
            }
        }
    }
    return result_pairs;
}

/**
 * Calculates Cramer's V from an observed 2D contingency table (row_key -> col_key -> count)
 */
function calculate_cramers_v(tableData) {
    let rowKeys = Object.keys(tableData);
    if (rowKeys.length <= 1) return 0; // Independence by definition if only 1 row

    let colKeysSet = new Set();
    rowKeys.forEach(r => Object.keys(tableData[r]).forEach(c => colKeysSet.add(c)));
    let colKeys = Array.from(colKeysSet);
    if (colKeys.length <= 1) return 0;

    let N_total = 0;
    let rowSums = {};
    let colSums = {};

    rowKeys.forEach(r => rowSums[r] = 0);
    colKeys.forEach(c => colSums[c] = 0);

    rowKeys.forEach(r => {
        colKeys.forEach(c => {
            let val = tableData[r][c] || 0;
            N_total += val;
            rowSums[r] += val;
            colSums[c] += val;
        });
    });

    if (N_total === 0) return 0;

    let chiSquare = 0;
    rowKeys.forEach(r => {
        colKeys.forEach(c => {
            let O = tableData[r][c] || 0;
            let E = (rowSums[r] * colSums[c]) / N_total;
            if (E > 0) {
                chiSquare += Math.pow(O - E, 2) / E;
            }
        });
    });

    let k = Math.min(rowKeys.length - 1, colKeys.length - 1);
    if (k === 0) return 0;

    let cramersV = Math.sqrt(chiSquare / (N_total * k));
    return cramersV;
}

/**
 * Implements Dominance-Based Linkage returning an LxL matrix.
 */
function dominance_linkage(solutions, fitnesses) {
    const L = solutions[0].length;
    const matrix = Array.from({ length: L }, () => new Array(L).fill(""));
    const result_pairs = get_paired_samples_from_observations(solutions);

    // --- NEW: Log the number of pairs found ---
    let totalPairs = 0;
    console.log("--- Dominance Linkage: Paired Samples Report ---");
    result_pairs.forEach((pairs, index) => {
        console.log(`Variable ${index}: ${pairs.length} pairs found`);
        totalPairs += pairs.length;
    });
    console.log(`Total paired samples across all variables: ${totalPairs}`);
    console.log("------------------------------------------------");
    // ------------------------------------------

    for (let a = 0; a < L; a++) {
        for (let b = 0; b < L; b++) {
            if (a === b) continue;

            const pairs = result_pairs[a];
            let partition_table = {}; // Map of val_b -> Map of (val1_val2_dom -> count)

            for (let [idx_x, idx_w] of pairs) {
                let x = solutions[idx_x];
                let w = solutions[idx_w];

                // Keep only pairs where x_b == w_b
                if (x[b] !== w[b]) continue;
                let val_b = x[b];

                let val_x_a = x[a];
                let val_w_a = w[a];

                let val1 = Math.min(val_x_a, val_w_a);
                let val2 = Math.max(val_x_a, val_w_a);

                let f_x = fitnesses[idx_x];
                let f_w = fitnesses[idx_w];

                let dominance;
                if (f_x === f_w) {
                    dominance = 'tie';
                } else if ((val_x_a === val1 && f_x > f_w) || (val_w_a === val1 && f_w > f_x)) {
                    dominance = 'greater';
                } else {
                    dominance = 'lower';
                }

                let col_key = `${val1}_${val2}_${dominance}`;

                if (!partition_table[val_b]) partition_table[val_b] = {};
                partition_table[val_b][col_key] = (partition_table[val_b][col_key] || 0) + 1;
            }

            matrix[a][b] = calculate_cramers_v(partition_table);
        }
    }
    return matrix;
}

/**
 * Implements Mutual Information of Survival returning an LxL matrix.
 */
function misurvival_linkage(solutions, fitnesses) {
    const N = solutions.length;
    const L = solutions[0].length;
    const matrix = Array.from({ length: L }, () => new Array(L).fill(""));

    let maxF = Math.max(...fitnesses);
    let minF = Math.min(...fitnesses);
    let diff = maxF - minF;

    // Scale to [0,1]
    let f_range_01 = fitnesses.map(f => (diff === 0) ? 1 : (f - minF) / diff);
    let sumF = f_range_01.reduce((acc, val) => acc + val, 0);

    // Survival probability per solution
    let survival = f_range_01.map(f => (sumF === 0) ? (1 / N) : (f / sumF));

    // Precompute marginal probabilities p_a
    let P_marginals = Array.from({ length: L }, () => ({}));
    for (let i = 0; i < N; i++) {
        let sol = solutions[i];
        let surv = survival[i];
        for (let a = 0; a < L; a++) {
            let val = sol[a];
            P_marginals[a][val] = (P_marginals[a][val] || 0) + surv;
        }
    }

    // Compute MI for every pair (a, b)
    for (let a = 0; a < L; a++) {
        for (let b = a + 1; b < L; b++) {
            let P_joint = {};
            for (let i = 0; i < N; i++) {
                let key = `${solutions[i][a]}_${solutions[i][b]}`;
                P_joint[key] = (P_joint[key] || 0) + survival[i];
            }

            let mi = 0;
            for (let key in P_joint) {
                let [val_a, val_b] = key.split('_').map(Number);
                let p_ab = P_joint[key];
                let p_a = P_marginals[a][val_a];
                let p_b = P_marginals[b][val_b];

                if (p_ab > 0 && p_a > 0 && p_b > 0) {
                    mi += p_ab * Math.log(p_ab / (p_a * p_b));
                }
            }
            matrix[a][b] = mi;
            matrix[b][a] = mi; // Symmetric
        }
    }
    return matrix;
}