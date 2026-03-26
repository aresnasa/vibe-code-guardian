/**
 * Vibe Code Guardian - Git Graph Data Provider
 * Fetches commit data and computes graph layout for visualization
 * Enhanced with improved git tracking and multi-user/multi-branch support
 */

import { GitManager } from './gitManager';
import {
    GraphCommit, GraphBranch, GraphTag,
    GitGraphData, CommitDetail, CommitFileChange,
    GitContributor, GitStash, GitRemote, GitBranchDetail
} from './types';

export class GitGraphProvider {
    private contributors: GitContributor[] = [];
    private stashes: GitStash[] = [];
    private remotes: GitRemote[] = [];
    private branchDetails: GitBranchDetail[] = [];

    constructor(private gitManager: GitManager) {}

    /**
     * Get full graph data with layout computation
     */
    public async getGraphData(mode: 'guardian' | 'full', maxCount: number = 200): Promise<GitGraphData> {
        const isGuardianMode = mode === 'guardian';

        const [rawCommits, rawBranches, rawTags, headInfo, contributors, stashes, remotes] = await Promise.all([
            this.gitManager.getGraphCommits(maxCount, isGuardianMode),
            this.gitManager.getAllBranches(),
            this.gitManager.getAllTags(),
            this.gitManager.getHeadInfo(),
            this.gitManager.getContributors(),
            this.gitManager.getStashList(),
            this.gitManager.getRemoteList()
        ]);

        // Cache multi-user data for enhanced display
        this.contributors = contributors;
        this.stashes = stashes;
        this.remotes = remotes;

        // Create commit lookup map for helper methods
        const commitMap = new Map<string, typeof rawCommits[0]>();
        for (const commit of rawCommits) {
            commitMap.set(commit.hash, commit);
        }

        // Build GraphCommit array
        const commits: GraphCommit[] = rawCommits.map((rc: any) => ({
            hash: rc.hash,
            abbreviatedHash: rc.abbreviatedHash,
            parents: rc.parents,
            authorName: rc.authorName,
            authorEmail: rc.authorEmail,
            date: rc.date,
            message: rc.message,
            refs: rc.refs ? rc.refs.split(',').map((r: string) => r.trim()).filter((r: string) => r) : [],
            isGuardianCommit: rc.message.includes('[Vibe Guardian]'),
            lane: 0,
            children: []
        }));

        // Build children references from parent data
        const graphCommitMap = new Map<string, GraphCommit>();
        for (const commit of commits) {
            graphCommitMap.set(commit.hash, commit);
        }
        for (const commit of commits) {
            for (const parentHash of commit.parents) {
                const parent = graphCommitMap.get(parentHash);
                if (parent) {
                    parent.children.push(commit.hash);
                }
            }
        }

        // Compute lane layout
        const { totalLanes } = this.computeLaneLayout(commits, graphCommitMap);

        // Build branches with enhanced tracking information
        let colorIdx = 0;
        const branches: GraphBranch[] = rawBranches.map((rb: any) => {
            const commit = commitMap.get(rb.commitHash);
            return {
                name: rb.name,
                isCurrent: rb.isCurrent,
                commitHash: rb.commitHash,
                isRemote: rb.isRemote,
                colorIndex: colorIdx++,
                tracking: rb.tracking,
                ahead: rb.ahead ?? 0,
                behind: rb.behind ?? 0,
                authorEmail: this.getCommitAuthor(rb.commitHash, commitMap),
                lastCommitDate: this.getCommitDate(rb.commitHash, commitMap)
            };
        });

        // Build tags
        const tags: GraphTag[] = rawTags.map((rt: any) => ({
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
            mode,
            // Enhanced multi-user data
            contributors: this.contributors,
            stashes: this.stashes,
            remotes: this.remotes,
            branchDetails: this.branchDetails
        };
    }

    /**
     * Get detailed information about a specific commit
     */
    public async getCommitDetail(hash: string): Promise<CommitDetail | null> {
        const fileChanges = await this.gitManager.getCommitFileChanges(hash);

        // Get commit metadata
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
                } else if (commitMap.has(firstParent)) {
                    // First parent is in the commit set – reserve this lane for it
                    activeLanes[lane] = firstParent;
                } else {
                    // First parent is NOT in the commit set (filtered out, e.g. a non-Guardian
                    // commit between two Guardian chains).  Release the lane so the next chain
                    // can reuse it instead of spreading onto a brand-new lane.
                    activeLanes[lane] = null;
                }

                // Additional parents (merge sources) need lanes too
                for (let i = 1; i < commit.parents.length; i++) {
                    const parentHash = commit.parents[i];
                    // Only allocate a lane if the parent is actually in the commit set
                    if (!commitMap.has(parentHash)) { continue; }
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

    /**
     * Get cached contributors data
     */
    public getContributors(): GitContributor[] {
        return this.contributors;
    }

    /**
     * Get cached stashes data
     */
    public getStashes(): GitStash[] {
        return this.stashes;
    }

    /**
     * Get cached remotes data
     */
    public getRemotes(): GitRemote[] {
        return this.remotes;
    }

    /**
     * Get cached branch details with tracking information
     */
    public getBranchDetails(): GitBranchDetail[] {
        return this.branchDetails;
    }

    /**
     * Get author email for a specific commit hash
     */
    public getCommitAuthor(commitHash: string, commitMap?: Map<string, any>): string {
        if (commitMap) {
            const commit = commitMap.get(commitHash);
            return commit?.authorEmail ?? '';
        }
        return '';
    }

    /**
     * Get commit date for a specific commit hash
     */
    public getCommitDate(commitHash: string, commitMap?: Map<string, any>): string {
        if (commitMap) {
            const commit = commitMap.get(commitHash);
            return commit?.date ?? '';
        }
        return '';
    }

    /**
     * Group related commits by user and time window
     * Enhanced tracking for better visualization of related code modifications
     */
    public groupRelatedCommits(commits: GraphCommit[], timeWindowMs: number = 3600000): Map<string, GraphCommit[]> {
        const groupedCommits = new Map<string, GraphCommit[]>();

        // Sort commits by date
        const sortedCommits = [...commits].sort((a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        );

        let currentGroup: GraphCommit[] = [];
        let lastCommit: GraphCommit | null = null;

        for (const commit of sortedCommits) {
            if (lastCommit) {
                const timeDiff = new Date(lastCommit.date).getTime() - new Date(commit.date).getTime();
                const sameAuthor = lastCommit.authorEmail === commit.authorEmail;

                // Group if same author and within time window
                if (sameAuthor && timeDiff < timeWindowMs) {
                    currentGroup.push(commit);
                } else {
                    // Save previous group and start new one
                    if (currentGroup.length > 0) {
                        const groupKey = `${currentGroup[0].authorEmail}-${currentGroup[0].date}`;
                        groupedCommits.set(groupKey, [...currentGroup]);
                    }
                    currentGroup = [commit];
                }
            } else {
                currentGroup = [commit];
            }
            lastCommit = commit;
        }

        // Don't forget the last group
        if (currentGroup.length > 0) {
            const groupKey = `${currentGroup[0].authorEmail}-${currentGroup[0].date}`;
            groupedCommits.set(groupKey, currentGroup);
        }

        return groupedCommits;
    }

    /**
     * Get branch activity by contributor
     */
    public getBranchActivityByContributor(commits: GraphCommit[]): Map<string, { commitCount: number; branches: string[] }> {
        const activityMap = new Map<string, { commitCount: number; branches: string[] }>();

        // Group commits by contributor email
        const contributorCommits = new Map<string, GraphCommit[]>();
        for (const commit of commits) {
            const email = commit.authorEmail;
            if (!contributorCommits.has(email)) {
                contributorCommits.set(email, []);
            }
            contributorCommits.get(email)!.push(commit);
        }

        // Build activity map
        for (const contributor of this.contributors) {
            const email = contributor.email;
            const emailCommits = contributorCommits.get(email) || [];

            // Get branches that this contributor has commits on
            const contributorBranches = new Set<string>();
            for (const commit of emailCommits) {
                // Find branches that point to this commit
                const relatedBranches = this.branchDetails
                    .filter(bd => bd.commitHash === commit.hash)
                    .map(bd => bd.name);
                relatedBranches.forEach(branch => contributorBranches.add(branch));
            }

            activityMap.set(email, {
                commitCount: contributor.commitCount,
                branches: Array.from(contributorBranches)
            });
        }

        return activityMap;
    }
}
