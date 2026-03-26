#!/usr/bin/env node
/**
 * Vibe Code Guardian — Git Graph Verification Script
 *
 * Builds a controlled git repository with a known commit graph (branches,
 * merges, tags, and [Vibe Guardian] commits), then validates every function
 * that GitManager/GitGraphProvider use for graph rendering.
 *
 * Also runs a secondary suite against the actual vibe-code-guardian repo to
 * catch regressions against real data.
 *
 * Usage:
 *   node scripts/verify-git-graph.mjs
 *   npm run verify-git-graph
 */

import { createRequire } from 'module';
import fs   from 'fs';
import path from 'path';
import os   from 'os';

// Load simple-git from the project's own node_modules so the version matches
// what the extension actually ships with.
const require = createRequire(import.meta.url);
const { simpleGit } = require('../node_modules/simple-git');

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[1m', X = '\x1b[0m';

let passed = 0, failed = 0, skipped = 0;

function ok(name)               { passed++; console.log(`  ${G}✅ PASS${X} ${name}`); }
function fail(name, reason)     { failed++; console.log(`  ${R}❌ FAIL${X} ${name}\n       ${R}${reason}${X}`); }
function skip(name, reason)     { skipped++; console.log(`  ${Y}⚠️  SKIP${X} ${name}: ${reason}`); }
function assert(c, name, why)   { c ? ok(name) : fail(name, why || 'assertion failed'); }
function header(title)          { console.log(`\n${B}Suite: ${title}${X}`); }

// ─── Mirror: gitManager.getGraphCommits ───────────────────────────────────────
async function getGraphCommits(git, maxCount = 200, guardianOnly = false) {
    const SEP = '<<GG_SEP>>';
    const REC = '<<GG_REC>>';
    const fmt = ['%H', '%h', '%P', '%an', '%ae', '%aI', '%s', '%D'].join(SEP);
    const args = ['log', '--all', `--max-count=${maxCount}`, `--format=${fmt}${REC}`];
    if (guardianOnly) args.push('--fixed-strings', '--grep=[Vibe Guardian]');

    const raw = await git.raw(args);
    if (!raw || !raw.trim()) return [];

    return raw.split(REC)
        .filter(r => r.trim())
        .map(record => {
            const p = record.trim().split(SEP);
            return {
                hash:            p[0] || '',
                abbreviatedHash: p[1] || '',
                parents:         (p[2] || '').split(' ').filter(x => x),
                authorName:      p[3] || '',
                authorEmail:     p[4] || '',
                date:            p[5] || '',
                message:         p[6] || '',
                refs:            p[7] || '',
            };
        })
        .filter(c => c.hash);
}

// ─── Mirror: gitManager.getAllBranches ────────────────────────────────────────
async function getAllBranches(git) {
    const summary = await git.branch(['-a', '-v', '--no-abbrev']);
    return summary.all.map(bn => {
        const b = summary.branches[bn];
        return {
            name:       bn,
            isCurrent:  b?.current ?? false,
            commitHash: b?.commit ?? '',
            isRemote:   bn.startsWith('remotes/'),
        };
    });
}

// ─── Mirror: gitManager.getAllTags ────────────────────────────────────────────
async function getAllTags(git) {
    const tagResult = await git.tags();
    const result = [];
    for (const tag of tagResult.all) {
        try {
            const hash = await git.raw(['rev-parse', tag]);
            result.push({ name: tag, commitHash: hash.trim() });
        } catch {
            result.push({ name: tag, commitHash: '' });
        }
    }
    return result;
}

// ─── Mirror: gitManager.getHeadInfo ──────────────────────────────────────────
async function getHeadInfo(git) {
    const status = await git.status();
    const commit = await git.revparse(['HEAD']);
    const isDetached = !status.current || status.current === 'HEAD' || status.detached;
    return {
        isDetached:    isDetached || false,
        currentCommit: commit.trim(),
        branch:        isDetached ? undefined : status.current || undefined,
    };
}

// ─── Mirror: gitGraphProvider.computeLaneLayout (after fix) ──────────────────
function computeLaneLayout(commits, commitMap) {
    if (commits.length === 0) return { totalLanes: 0 };

    const activeLanes = [];

    const findFree = () => {
        const i = activeLanes.indexOf(null);
        if (i >= 0) return i;
        activeLanes.push(null);
        return activeLanes.length - 1;
    };
    const findFor  = h => activeLanes.indexOf(h);

    for (const commit of commits) {
        let lane = findFor(commit.hash);
        if (lane < 0) lane = findFree();
        commit.lane = lane;

        if (commit.parents.length === 0) {
            activeLanes[lane] = null;
        } else {
            const firstParent = commit.parents[0];
            const existingLane = findFor(firstParent);
            if (existingLane >= 0) {
                activeLanes[lane] = null;                        // convergence
            } else if (commitMap.has(firstParent)) {
                activeLanes[lane] = firstParent;                 // continue lane
            } else {
                activeLanes[lane] = null;                        // parent filtered out → release
            }
            for (let i = 1; i < commit.parents.length; i++) {
                const ph = commit.parents[i];
                if (!commitMap.has(ph)) continue;               // skip filtered parents
                if (findFor(ph) < 0) {
                    const nl = findFree();
                    activeLanes[nl] = ph;
                }
            }
        }
    }
    return { totalLanes: Math.max(activeLanes.length, 1) };
}

// ─── Mirror: gitGraphProvider.getGraphData ────────────────────────────────────
async function getGraphData(git, mode, maxCount = 200) {
    const guardianOnly = mode === 'guardian';
    const [rawCommits, rawBranches, rawTags, headInfo] = await Promise.all([
        getGraphCommits(git, maxCount, guardianOnly),
        getAllBranches(git),
        getAllTags(git),
        getHeadInfo(git),
    ]);

    const commits = rawCommits.map(rc => ({
        hash:             rc.hash,
        abbreviatedHash:  rc.abbreviatedHash,
        parents:          rc.parents,
        authorName:       rc.authorName,
        authorEmail:      rc.authorEmail,
        date:             rc.date,
        message:          rc.message,
        refs:             rc.refs ? rc.refs.split(',').map(r => r.trim()).filter(Boolean) : [],
        isGuardianCommit: rc.message.includes('[Vibe Guardian]'),
        lane:             0,
        children:         [],
    }));

    const commitMap = new Map();
    for (const c of commits) commitMap.set(c.hash, c);
    for (const c of commits) {
        for (const ph of c.parents) {
            const parent = commitMap.get(ph);
            if (parent) parent.children.push(c.hash);
        }
    }

    const { totalLanes } = computeLaneLayout(commits, commitMap);
    return {
        commits, branches: rawBranches, tags: rawTags,
        headHash:      headInfo.currentCommit || '',
        isDetached:    headInfo.isDetached,
        currentBranch: headInfo.branch,
        totalLanes,
        mode,
    };
}

// ─── Create controlled test repo ─────────────────────────────────────────────
async function setupTestRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcg-verify-'));
    const git  = simpleGit(dir);
    // Force branch name to 'main' so tests are environment-independent.
    // Older git versions use `-b`, all modern ones accept `--initial-branch`.
    await git.raw(['init', '--initial-branch=main']).catch(() => git.init());
    // After plain init the default branch may be 'master', rename it.
    const status = await git.status().catch(() => null);
    if (status?.current && status.current !== 'main') {
        // No commits yet: git branch -m suffices
        await git.raw(['branch', '-m', status.current, 'main']).catch(() => {});
    }
    await git.addConfig('user.name',  'Verifier');
    await git.addConfig('user.email', 'verify@test.local');

    const write = (name, content) =>
        fs.writeFileSync(path.join(dir, name), content, 'utf8');

    // ── main branch: init → guardian → regular → guardian (v1.0.0 tag) ───
    write('a.txt', 'alpha\n');
    await git.add('.'); await git.commit('init: first commit');

    write('b.txt', 'beta\n');
    await git.add('.'); await git.commit('[Vibe Guardian] 🤖 Copilot @ 01-01 10:00');

    write('c.txt', 'gamma\n');
    await git.add('.'); await git.commit('regular commit not tracked');

    write('d.txt', 'delta\n');
    await git.add('.'); await git.commit('[Vibe Guardian] 📸 Auto-save @ 01/01 10:05');

    await git.addTag('v1.0.0');

    // ── feature branch off main ───────────────────────────────────────────
    await git.checkoutLocalBranch('feature/x');

    write('e.txt', 'epsilon\n');
    await git.add('.'); await git.commit('[Vibe Guardian] 🤖 Claude @ 01-01 10:10');

    write('f.txt', 'zeta\n');
    await git.add('.'); await git.commit('feature work (not guardian)');

    // ── back to main, add a commit, then merge feature/x ─────────────────
    await git.checkout('main');

    write('g.txt', 'eta\n');
    await git.add('.'); await git.commit('[Vibe Guardian] 📸 Auto-save @ 01/01 10:15');

    // Merge commit with Guardian prefix so it shows in guardian mode
    await git.merge(['feature/x', '--no-ff', '-m', '[Vibe Guardian] Merge feature/x into main']);

    // ── second tag after merge ────────────────────────────────────────────
    await git.addTag('v1.1.0');

    return { dir, git };
}

// ─── Test suites ──────────────────────────────────────────────────────────────

async function suiteBasicData(git) {
    header('Basic Git Data');

    const commits = await getGraphCommits(git, 50);
    assert(commits.length >= 8,
        `getGraphCommits returns ≥8 commits (got ${commits.length})`);
    assert(commits.every(c => c.hash.length === 40),
        'all hashes are 40 chars',
        'bad hash: ' + (commits.find(c => c.hash.length !== 40)?.hash ?? ''));
    assert(commits.every(c => c.message.length > 0),
        'all commits have messages');
    assert(commits.every(c => Array.isArray(c.parents)),
        'all commits have parents array');
    assert(commits.every(c => typeof c.date === 'string' && c.date.length > 0),
        'all commits have ISO date');

    const branches = await getAllBranches(git);
    assert(branches.length >= 2,
        `getAllBranches returns ≥2 branches (got ${branches.length})`);
    assert(branches.some(b => b.isCurrent),
        'one branch is marked current');
    assert(branches.some(b => b.name === 'feature/x'),
        'feature/x branch exists');
    assert(branches.every(b => b.commitHash.length > 0),
        'all branches have a commitHash');

    const tags = await getAllTags(git);
    assert(tags.length === 2,
        `getAllTags returns 2 tags (got ${tags.length})`);
    assert(tags.some(t => t.name === 'v1.0.0'), 'v1.0.0 tag exists');
    assert(tags.some(t => t.name === 'v1.1.0'), 'v1.1.0 tag exists');
    assert(tags.every(t => t.commitHash.length > 0),
        'all tags have a commitHash');

    const head = await getHeadInfo(git);
    assert(!head.isDetached,          'HEAD is not detached');
    assert(head.branch === 'main',    `current branch is main (got '${head.branch}')`);
    assert(head.currentCommit.length === 40, 'HEAD commit is 40 chars');
}

async function suiteGuardianFilter(git) {
    header('Guardian Commit Filter');

    const all      = await getGraphCommits(git, 50, false);
    const guardian = await getGraphCommits(git, 50, true);

    assert(guardian.length > 0, `guardian mode returns commits (got ${guardian.length})`);
    assert(guardian.length < all.length,
        `guardian count (${guardian.length}) < full count (${all.length})`);
    assert(guardian.every(c => c.message.includes('[Vibe Guardian]')),
        'every guardian commit has [Vibe Guardian] in message',
        'offender: ' + (guardian.find(c => !c.message.includes('[Vibe Guardian]'))?.message ?? ''));
    assert(all.some(c => !c.message.includes('[Vibe Guardian]')),
        'full mode includes non-guardian commits');

    // Exact counts: 5 guardian commits created (b, d, e, g, merge)
    assert(guardian.length === 5,
        `exactly 5 guardian commits (got ${guardian.length})`);
}

async function suiteLaneLayoutFull(git) {
    header('Lane Layout — Full Mode');

    const data = await getGraphData(git, 'full');
    const { commits, totalLanes } = data;

    assert(commits.length >= 8, `full graph has ≥8 commits (got ${commits.length})`);
    assert(totalLanes > 0,      `totalLanes > 0 (got ${totalLanes})`);
    assert(commits.every(c => c.lane >= 0),
        'all lanes are non-negative',
        'neg lane at: ' + commits.find(c => c.lane < 0)?.abbreviatedHash);
    assert(commits.every(c => c.lane < totalLanes),
        'all lanes < totalLanes',
        `lane ${commits.find(c => c.lane >= totalLanes)?.lane} >= ${totalLanes}`);

    const mergeCommit = commits.find(c => c.parents.length > 1);
    assert(!!mergeCommit, 'merge commit (parents>1) found in full graph');
    if (mergeCommit) {
        assert(mergeCommit.isGuardianCommit, 'merge commit is a Guardian commit');
    }

    assert(commits.every(c => Array.isArray(c.children)),
        'all commits have children array');

    // Root commit (oldest) has no parents
    const root = commits[commits.length - 1];
    assert(root.parents.length === 0, 'oldest commit has no parents');
}

async function suiteLaneLayoutGuardian(git) {
    header('Lane Layout — Guardian Mode (lane-leak fix)');

    const data = await getGraphData(git, 'guardian');
    const { commits, totalLanes } = data;

    assert(commits.length === 5,
        `guardian graph has 5 commits (got ${commits.length})`);
    assert(commits.every(c => c.lane >= 0),
        'guardian: all lanes non-negative');
    assert(commits.every(c => c.lane < totalLanes),
        'guardian: all lanes < totalLanes',
        `lane ${commits.find(c => c.lane >= totalLanes)?.lane} >= ${totalLanes}`);

    // KEY assertion: Before the lane-leak fix, guardian mode would create one new
    // lane per "chain segment" (between non-guardian parent breaks), easily
    // hitting 4-5 lanes for this test repo.  After the fix it must stay ≤2:
    // lane 0 for the main Guardian chain, lane 1 for the feature branch commit.
    assert(totalLanes <= 2,
        `guardian mode uses ≤2 lanes (got ${totalLanes}) — lane-leak fix operative`,
        `Expected ≤2 lanes but got ${totalLanes}. Likely lane-leak regression.`);
}

async function suiteChildrenLinks(git) {
    header('Children Backlinks');

    const data = await getGraphData(git, 'full');
    const commitMap = new Map(data.commits.map(c => [c.hash, c]));

    let broken = 0;
    for (const c of data.commits) {
        for (const ph of c.parents) {
            const parent = commitMap.get(ph);
            if (parent && !parent.children.includes(c.hash)) {
                broken++;
                fail(`parent ${ph.substring(0,8)} has child ${c.hash.substring(0,8)} in children[]`);
            }
        }
    }
    if (broken === 0) {
        ok('all parent→child backlinks are symmetric');
    }
}

async function suiteTagAncestry(git) {
    header('Tag Commit Ancestry');

    const tags    = await getAllTags(git);
    const commits = await getGraphCommits(git, 50);
    const hashes  = new Set(commits.map(c => c.hash));

    for (const tag of tags) {
        assert(hashes.has(tag.commitHash),
            `tag ${tag.name} points to a commit in the graph (${tag.commitHash.substring(0,8)})`);
    }
}

async function suiteBranchHeads(git) {
    header('Branch → Commit Integrity');

    const branches = await getAllBranches(git);
    const commits  = await getGraphCommits(git, 50);
    const hashes   = new Set(commits.map(c => c.hash));

    for (const b of branches) {
        if (b.isRemote) continue;
        assert(hashes.has(b.commitHash),
            `branch '${b.name}' HEAD (${b.commitHash.substring(0,8)}) is in commit graph`);
    }
}

async function suiteRawDiffTree(git) {
    header('Commit File Changes (diff-tree)');

    const commits = await getGraphCommits(git, 50);
    if (commits.length === 0) { skip('diff-tree', 'no commits'); return; }

    // Test a non-root, non-merge commit so diff-tree always has exactly one parent
    const nonRoot = commits.find(c => c.parents.length === 1);
    if (!nonRoot) { skip('diff-tree non-root', 'all commits are roots'); return; }

    try {
        const raw = await git.raw([
            'diff-tree', '--no-commit-id', '-r', '--numstat', nonRoot.hash
        ]);
        assert(typeof raw === 'string',
            `diff-tree returns string for ${nonRoot.abbreviatedHash}`);
        // At least one file should appear in each non-root commit
        const lines = raw.trim().split('\n').filter(Boolean);
        assert(lines.length > 0,
            `diff-tree shows files changed in ${nonRoot.abbreviatedHash} (${lines.length} lines)`);
    } catch (e) {
        fail(`diff-tree for ${nonRoot.abbreviatedHash}`, String(e));
    }
}

// ─── Suite: current vibe-code-guardian repo ───────────────────────────────────
async function suiteCurrentRepo() {
    header('Current Repo — vibe-code-guardian (real data)');

    const scriptDir = path.dirname(new URL(import.meta.url).pathname);
    const repoDir   = path.resolve(scriptDir, '..');
    const git       = simpleGit(repoDir);

    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) { skip('current repo suite', 'directory is not a git repo'); return; }

    // Guardian commits exist
    const guardian = await getGraphCommits(git, 200, true);
    assert(guardian.length > 0,
        `current repo has Guardian commits (got ${guardian.length})`);
    assert(guardian.every(c => c.message.includes('[Vibe Guardian]')),
        'all current-repo guardian commits carry the marker');

    // Lane layout is compact in guardian mode
    const guardianData = await getGraphData(git, 'guardian', 200);
    assert(guardianData.commits.length > 0,
        'guardian graph has commits');
    assert(guardianData.totalLanes <= 3,
        `current-repo guardian mode uses ≤3 lanes (got ${guardianData.totalLanes})`,
        `Got ${guardianData.totalLanes} lanes — possible lane-leak regression`);
    assert(guardianData.commits.every(c => c.lane < guardianData.totalLanes),
        'current-repo: no commit has lane ≥ totalLanes');

    // Full history
    const fullData = await getGraphData(git, 'full', 100);
    assert(fullData.commits.length > 0, 'full history returns commits');
    assert(fullData.branches.length > 0, 'current repo has branches');

    // Children backlinks hold in real data
    const commitMap = new Map(fullData.commits.map(c => [c.hash, c]));
    const broken = fullData.commits.filter(c =>
        c.parents.some(ph => {
            const parent = commitMap.get(ph);
            return parent && !parent.children.includes(c.hash);
        })
    ).length;
    assert(broken === 0,
        `current-repo: all children backlinks valid (${broken} broken)`);
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`${B}══════════════════════════════════════════════════${X}`);
    console.log(`${B}   Vibe Code Guardian — Git Graph Verification   ${X}`);
    console.log(`${B}══════════════════════════════════════════════════${X}`);

    let dir;
    try {
        process.stdout.write('\n⚙️  Creating controlled test repository … ');
        const setup = await setupTestRepo();
        dir = setup.dir;
        const git = setup.git;
        console.log(`${Y}${dir}${X}`);

        await suiteBasicData(git);
        await suiteGuardianFilter(git);
        await suiteLaneLayoutFull(git);
        await suiteLaneLayoutGuardian(git);
        await suiteChildrenLinks(git);
        await suiteTagAncestry(git);
        await suiteBranchHeads(git);
        await suiteRawDiffTree(git);
        await suiteCurrentRepo();

    } finally {
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
            console.log('\n🧹 Cleaned up temp repo');
        }
    }

    console.log(`\n${B}══════════════════════════════════════════════════${X}`);
    const summary = [
        `${G}${passed} passed${X}`,
        failed  ? `${R}${failed} failed${X}`  : `${failed} failed`,
        skipped ? `${Y}${skipped} skipped${X}` : `${skipped} skipped`,
    ].join('  ');
    console.log(`  Results: ${summary}`);
    console.log(`${B}══════════════════════════════════════════════════${X}\n`);

    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error(`\n${R}Fatal error: ${err?.message ?? err}${X}`);
    if (err?.stack) console.error(err.stack);
    process.exit(1);
});
