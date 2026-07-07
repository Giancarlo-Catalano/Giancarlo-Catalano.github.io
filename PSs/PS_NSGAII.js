// PS_NSGAII.js

// --- 1. Utilities and Pareto Sorting ---

function dominates(p, q) {
    let strict_better = false;
    for (let i = 0; i < p.length; i++) {
        if (p[i] > q[i]) return false; // Since we MINIMIZE all objectives
        if (p[i] < q[i]) strict_better = true;
    }
    return strict_better;
}

function get_pareto_fronts(population_fitness) {
    let pareto_fronts = { 0: [] };
    let subs = {};
    let dom_count = {};

    for (let i = 0; i < population_fitness.length; i++) {
        subs[i] = [];
        dom_count[i] = 0;
        let p = population_fitness[i];

        for (let j = 0; j < population_fitness.length; j++) {
            if (i === j) continue;
            let q = population_fitness[j];

            if (dominates(p, q)) {
                subs[i].push(j);
            } else if (dominates(q, p)) {
                dom_count[i]++;
            }
        }

        if (dom_count[i] === 0) {
            pareto_fronts[0].push(i);
        }
    }

    let i = 0;
    while (true) {
        let F_i = pareto_fronts[i];
        if (!F_i || F_i.length === 0) break;

        let Q = [];
        for (let p_idx of F_i) {
            for (let q_idx of subs[p_idx]) {
                dom_count[q_idx]--;
                if (dom_count[q_idx] === 0) {
                    Q.push(q_idx);
                }
            }
        }
        pareto_fronts[i + 1] = Q;
        i++;
    }

    let pareto_front_lists = [];
    for (let key in pareto_fronts) {
        if (pareto_fronts[key].length > 0) {
            pareto_front_lists.push(pareto_fronts[key]);
        }
    }
    return pareto_front_lists;
}

// --- 2. Operators ---

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Any-Pattern (Global) Operators
const OperatorsGlobal = {
    sample: function(L, search_space) {
        const prob_fixed = 0.83;
        let ps = new Array(L).fill(-1);
        let keep_going = true;
        while (keep_going) {
            let variable = Math.floor(Math.random() * L);
            let value = Math.floor(Math.random() * search_space[variable]);
            ps[variable] = value;
            keep_going = Math.random() < prob_fixed;
        }
        return ps;
    },
    mutate: function(ps, L, search_space) {
        const mutation_prob = 1 / L;
        let yps = [...ps];
        for (let i = 0; i < L; i++) {
            if (Math.random() < mutation_prob) {
                if (yps[i] === -1) {
                    yps[i] = Math.floor(Math.random() * search_space[i]);
                } else {
                    yps[i] = -1;
                }
            }
        }
        return yps;
    },
    crossover: function(ps_a, ps_b, L) {
        let child_a = [...ps_a], child_b = [...ps_b];
        for (let i = 0; i < L; i++) {
            if (Math.random() < 0.5) {
                let temp = child_a[i];
                child_a[i] = child_b[i];
                child_b[i] = temp;
            }
        }
        return [child_a, child_b];
    }
};

// Subset-of-Solution (Local) Operators
const OperatorsLocal = {
    sample: function(L, target_solution) {
        const prob_fixed = 0.86;
        let ps = new Array(L).fill(-1);
        let keep_going = true;
        while (keep_going) {
            let variable = Math.floor(Math.random() * L);
            ps[variable] = target_solution[variable];
            keep_going = Math.random() < prob_fixed;
        }
        return ps;
    },
    mutate: function(ps, L, target_solution) {
        const mutation_prob = 1 / L;
        let yps = [...ps];
        for (let i = 0; i < L; i++) {
            if (Math.random() < mutation_prob) {
                if (yps[i] === -1) {
                    yps[i] = target_solution[i];
                } else {
                    yps[i] = -1;
                }
            }
        }
        return yps;
    }
};

// --- 3. NSGA-II Engine ---

class PS_NSGAII {
    constructor(L, search_space, objectives, budget, pop_size, operators) {
        this.L = L;
        this.search_space = search_space;
        this.objectives = objectives;
        this.budget = budget;
        this.pop_size = pop_size;
        this.operators = operators;

        this.cache = new Map();
        this.evaluations_done = 0;
    }

    evaluate(ps) {
        let key = ps.join(',');
        if (this.cache.has(key)) return this.cache.get(key);
        
        let scores = this.objectives.map(objFn => {
            let val = objFn(ps);
            // Safety Net: Convert NaN or null to Infinity so it gets immediately dominated
            return (isNaN(val) || val === null) ? Infinity : val;
        });
        
        this.cache.set(key, scores);
        this.evaluations_done++;
        return scores;
    }

    tournamentSelection(population, ranks, k = 3) {
        let best_idx = -1;
        let best_rank = Infinity;
        for (let i = 0; i < k; i++) {
            let idx = Math.floor(Math.random() * population.length);
            if (ranks[idx] < best_rank) {
                best_rank = ranks[idx];
                best_idx = idx;
            }
        }
        return population[best_idx];
    }

    // Refactored to be Async to allow UI repaints (Loading Bar)
    async run(progressCallback) {
        let population = [];
        let pop_set = new Set();

        let fails = 0;
        while (population.length < this.pop_size && fails < 1000) {
            let ind = this.operators.sample();
            let key = ind.join(',');
            if (!pop_set.has(key)) {
                pop_set.add(key);
                population.push(ind);
            } else {
                fails++;
            }
        }

        let generation_count = 0;

        while (this.evaluations_done < this.budget) {
            let fitnesses = population.map(ind => this.evaluate(ind));
            let fronts = get_pareto_fronts(fitnesses);

            let ranks = new Array(population.length).fill(0);
            for (let i = 0; i < fronts.length; i++) {
                for (let idx of fronts[i]) {
                    ranks[idx] = i;
                }
            }

            let children = [];
            let needed = this.pop_size;

            while (children.length < needed) {
                if (Math.random() < 0.9) {
                    let p1 = this.tournamentSelection(population, ranks);
                    let p2 = this.tournamentSelection(population, ranks);
                    let [c1, c2] = OperatorsGlobal.crossover(p1, p2, this.L);
                    children.push(this.operators.mutate(c1));
                    children.push(this.operators.mutate(c2));
                } else {
                    let p = this.tournamentSelection(population, ranks);
                    children.push(this.operators.mutate(p));
                }
            }

            let combined = [...population, ...children];
            let unique_combined = [];
            let unique_set = new Set();
            for (let ind of combined) {
                let k = ind.join(',');
                if (!unique_set.has(k)) {
                    unique_set.add(k);
                    unique_combined.push(ind);
                }
            }

            let combined_fit = unique_combined.map(ind => this.evaluate(ind));
            let combined_fronts = get_pareto_fronts(combined_fit);

            let next_pop = [];
            let f = 0;
            while (f < combined_fronts.length && next_pop.length + combined_fronts[f].length <= this.pop_size) {
                for (let idx of combined_fronts[f]) {
                    next_pop.push(unique_combined[idx]);
                }
                f++;
            }

            if (next_pop.length < this.pop_size && f < combined_fronts.length) {
                let remainder = combined_fronts[f];
                remainder.sort(() => 0.5 - Math.random());
                let to_add = this.pop_size - next_pop.length;
                for (let i = 0; i < to_add; i++) {
                    next_pop.push(unique_combined[remainder[i]]);
                }
            }
            population = next_pop;

            generation_count++;
            // Yield to the main thread every 5 generations to update the progress bar
            if (generation_count % 5 === 0 && progressCallback) {
                progressCallback(this.evaluations_done, this.budget);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        // Final UI update
        if (progressCallback) progressCallback(this.budget, this.budget);

        let final_fits = population.map(ind => this.evaluate(ind));
        let final_fronts = get_pareto_fronts(final_fits);
        let best_individuals = final_fronts[0].map(idx => ({
            ps: population[idx],
            objectives: final_fits[idx]
        }));

        return sort_by_worst_rank(best_individuals);
    }
}

// --- 4. Minimax Regret Sorting (Corrected for Minimization + Tie-breakers) ---

function sort_by_worst_rank(population_objects) {
    if (population_objects.length === 0) return [];
    let num_objs = population_objects[0].objectives.length;

    // Initialize ranks array. 1 is the best rank.
    population_objects.forEach(ind => ind.ranks = new Array(num_objs).fill(1));

    for (let o = 0; o < num_objs; o++) {
        let values = population_objects.map(p => p.objectives[o]);

        for (let i = 0; i < population_objects.length; i++) {
            let strictly_better_count = 0;
            for (let j = 0; j < values.length; j++) {
                // Because we are minimizing, a smaller value is better.
                if (values[j] < population_objects[i].objectives[o]) {
                    strictly_better_count++;
                }
            }
            // Rank is 1 + the number of individuals strictly better than you
            population_objects[i].ranks[o] = 1 + strictly_better_count;
        }
    }

    population_objects.forEach(ind => {
        ind.worst_rank = Math.max(...ind.ranks);
        ind.sum_ranks = ind.ranks.reduce((a, b) => a + b, 0); // Used as a tie-breaker
    });

    // Sort ascending by worst rank. If tied, sort by sum of ranks.
    return population_objects.sort((a, b) => {
        if (a.worst_rank !== b.worst_rank) {
            return a.worst_rank - b.worst_rank;
        }
        return a.sum_ranks - b.sum_ranks;
    });
}

// --- 5. Descriptor Finding (ECDF) ---

function generate_random_ps_of_size(fixed_count, L, search_space) {
    let ps = new Array(L).fill(-1);
    let indices = Array.from({length: L}, (_, i) => i);
    indices.sort(() => 0.5 - Math.random());

    for (let i = 0; i < fixed_count; i++) {
        let idx = indices[i];
        ps[idx] = Math.floor(Math.random() * search_space[idx]);
    }
    return ps;
}

function calculate_descriptors(ps, PRefDatabase, proxyData, threshold = 0.1, samples = 100) {
    let fixed_count = ps.filter(x => x !== -1).length;
    let L = ps.length;
    let search_space = new Array(L).fill(0).map((_, i) => {
        let max_val = 0;
        PRefDatabase.solutions.forEach(s => max_val = Math.max(max_val, s[i]));
        return max_val + 1;
    });

    let proxy_keys = Object.keys(proxyData[0]);
    let results = [];

    let { matchIndices } = PRefDatabase.getMatches(ps);
    if (matchIndices.size === 0) return [];

    let matchArr = Array.from(matchIndices);
    let target_avgs = {};
    proxy_keys.forEach(k => {
        let sum = matchArr.reduce((acc, idx) => acc + Number(proxyData[idx][k]), 0);
        target_avgs[k] = sum / matchArr.length;
    });

    let sampled_avgs = {};
    proxy_keys.forEach(k => sampled_avgs[k] = []);

    for (let i = 0; i < samples; i++) {
        let random_ps = generate_random_ps_of_size(fixed_count, L, search_space);
        let r_matches = PRefDatabase.getMatches(random_ps).matchIndices;
        if (r_matches.size > 0) {
            let rMatchArr = Array.from(r_matches);
            proxy_keys.forEach(k => {
                let sum = rMatchArr.reduce((acc, idx) => acc + Number(proxyData[idx][k]), 0);
                sampled_avgs[k].push(sum / rMatchArr.length);
            });
        }
    }

    proxy_keys.forEach(k => {
        let target_val = target_avgs[k];
        let dist = sampled_avgs[k];
        if (dist.length === 0) return;

        let lower_count = dist.filter(v => v <= target_val).length;
        let percentile = lower_count / dist.length;

        if (percentile <= threshold || percentile >= (1 - threshold)) {
            results.push({
                name: k,
                average: target_val,
                percentile: percentile
            });
        }
    });

    return results;
}
