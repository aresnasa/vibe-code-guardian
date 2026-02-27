/**
 * Vibe Code Guardian - Git Graph Data Provider
 * Fetches commit data and computes graph layout for visualization
 */

import { GitManager } from './gitManager';
import {
    GraphCommit, GraphBranch, GraphTag,
    GitGraphData, CommitDetail, CommitFileChange
} from './types';

export class GitGraphProvider {
    constructor(private gitManager: GitManager) {}

    /**
     * Get full graph data with layout computation
     */
    public async getGraphData(mode: 'guardian' | 'full', maxCount: number = 200): Promise<GitGraphData> {
        const guardianOnly = mode === 'guardian';

        const [rawCommits, rawBranches, rawTags, headInfo] = await Promise.all([
            this.gitManager.getGraphCommits(maxCount, guardianOnly),
            this.gitManager.getAllBranches(),
            this.gitManager.getAllTags(),
            this.gitManager.getHeadInfo()
        ]);

        // Build GraphCommit array
        const commits: GraphCommit[] = rawCommits.map(rc => ({
            hash: rc.hash,
            abbreviatedHash: rc.abbreviatedHash,
            parents: rc.parents,
            authorName: rc.authorName,
            authorEmail: rc.authorEmail,
            date: rc.date,
            message: rc.message,
            refs: rc.refs ? rc.refs.split(',').map(r => r.trim()).filter(r => r) : [],
            isGuardianCommit: rc.message.includes('[Vibe Guardian]'),
            lane: 0,
            children: []
        }));

        // Build children references from parent data
        const commitMap = new Map<string, GraphCommit>();
        for (const commit of commits) {
            commitMap.set(commit.hash, commit);
        }
        for (const commit of commits) {
            for (const parentHash of commit.parents) {
                const parent = commitMap.get(parentHash);
                if (parent) {
                    parent.children.push(commit.hash);
                }
            }
        }

        // Compute lane layout
        const { totalLanes } = this.computeLaneLayout(commits, commitMap);

        // Build branches with color assignment
        let colorIdx = 0;
        const branches: GraphBranch[] = rawBranches.map(rb => ({
            name: rb.name,
            isCurrent: rb.isCurrent,
            commitHash: rb.commitHash,
            isRemote: rb.isRemote,
            colorIndex: colorIdx++
        }));

        // Build tags
        const tags: GraphTag[] = rawTags.map(rt => ({
            name: rt.name,
            commitHash: rt.commitHash
        }));

        return {
            commits,
            branches,
            tags,
            headHash: headInfo.currentCommit || '',
            isDetached: headInfo.isDetached,
            currentBranch: headInfo.branch || undefined,
            totalLanes,
            mode
        };
    }

    /**
     * Get detailed information about a specific commit
     */
    public async getCommitDetail(hash: string): Promise<CommitDetail | null> {
        const rawCommits = await this.gitManager.getGraphCommits(1, false);
        // We need a single-commit fetch; use getGraphCommits isn't ideal.
        // Instead, fetch the commit info and file changes directly.
        const fileChanges = await this.gitManager.getCommitFileChanges(hash);

        // Get commit metadata via getGraphCommits with the specific hash
        const allCommits = await this.gitManager.getGraphCommits(500, false);
        const commit = allCommits.find(c => c.hash === hash);

        if (!commit) {
            return null;
        }

        const changedFiles: CommitFileChange[] = fileChanges.map(fc => ({
            path: fc.path,
            insertions: fc.insertions,
            deletions: fc.deletions,
            binary: fc.binary,
            status: fc.status as CommitFileChange['status']
        }));

        return {
            hash: commit.hash,
            authorName: commit.authorName,
            authorEmail: commit.authorEmail,
            date: commit.date,
            fullMessage: commit.message,
            parents: commit.parents,
            changedFiles
        };
    }

    /**
     * Compute lane assignment for graph layout.
     * Processes commits in topological order (as returned by git log),
     * assigning each commit to a lane to minimize visual crossings.
     */
    private computeLaneLayout(
        commits: GraphCommit[],
        commitMap: Map<string, GraphCommit>
    ): { totalLanes: number } {
        if (commits.length === 0) {
            return { totalLanes: 0 };
        }

        // activeLanes[i] = hash of the commit currently "flowing through" lane i
        // null means the lane is free
        const activeLanes: (string | null)[] = [];

        const findFreeLane = (): number => {
            const idx = activeLanes.indexOf(null);
            if (idx >= 0) { return idx; }
            activeLanes.push(null);
            return activeLanes.length - 1;
        };

        const findLaneForHash = (hash: string): number => {
            return activeLanes.indexOf(hash);
        };

        for (const commit of commits) {
            // Check if any lane is already reserved for this commit
            let lane = findLaneForHash(commit.hash);

            if (lane < 0) {
                // No lane reserved, assign a free one
                lane = findFreeLane();
            }

            commit.lane = lane;

            // Now handle parents: the first parent continues on the same lane,
            // additional parents get their own lanes (merge lines)
            if (commit.parents.length === 0) {
                // Root commit - release lane
                activeLanes[lane] = null;
            } else {
                // First parent continues on this lane
                const firstParent = commit.parents[0];
                const existingLaneForFirstParent = findLaneForHash(firstParent);

                if (existingLaneForFirstParent >= 0) {
                    // First parent is already on another lane (convergence)
                    // Release current lane
                    activeLanes[lane] = null;
                } else {
                    // Reserve current lane for first parent
                    activeLanes[lane] = firstParent;
                }

                // Additional parents (merge sources) need lanes too
                for (let i = 1; i < commit.parents.length; i++) {
                    const parentHash = commit.parents[i];
                    const existingLane = findLaneForHash(parentHash);
                    if (existingLane < 0) {
                        // Parent not yet assigned a lane; assign one
                        const newLane = findFreeLane();
                        activeLanes[newLane] = parentHash;
                    }
                }
            }
        }

        const totalLanes = Math.max(activeLanes.length, 1);
        return { totalLanes };
    }
}
