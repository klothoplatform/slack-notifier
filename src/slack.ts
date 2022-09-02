import {
    IssueCommentCreatedEvent,
    IssueCommentEvent,
    PullRequest,
    PullRequestClosedEvent,
    PullRequestConvertedToDraftEvent,
    PullRequestEvent,
    PullRequestOpenedEvent,
    PullRequestReadyForReviewEvent,
    PullRequestReviewCommentCreatedEvent,
    PullRequestReviewCommentEvent,
    PullRequestReviewEvent,
    PullRequestReviewSubmittedEvent,
    PullRequestSynchronizeEvent,
    SimplePullRequest,
} from '@octokit/webhooks-types';
import { WebClient } from '@slack/web-api'
import e = require('express');

/**
 * @klotho::persist {
 *  id = "security-tokens"
 *  secret = true
 * }
 */
import secretsFs = require("fs/promises");
/*
 * @klotho::persist {
 *   id = "slack_ids"
 * }
 */
let prThreads = new Map<string, string | undefined>()

/*
 * @klotho::persist {
 *   id = "last_commenter"
 * }
 */
let lastCommenter = new Map<string, string>()


export class Slack {

    private io: SlackIO

    constructor(io?: SlackIO) {
        this.io = io ?? createRealIO()
    }

    async handleEvent(channel: string, event: PullRequestEvent | PullRequestReviewEvent | IssueCommentEvent | PullRequestReviewCommentEvent) {
        const bannedLogins = await this.getBannedGithubLogins()
        if (bannedLogins.includes(event.sender.login)) {
            console.log(`${event.sender.login} is on the blocklist. ignoring message.`)
            return
        }
        switch (event.action) {
            // PullRequestEvent...
            case 'opened':
                await this.handlePrOpened(channel, event)
                break
            case 'converted_to_draft':
                await this.handlePrConvertedToDraft(channel, event)
                break
            case 'closed':
                await this.handlePrClosed(channel, event)
                break
            case 'ready_for_review':
                await this.handlePrReadyForReview(channel, event)
                break
            case 'synchronize':
                await this.handlePrSynchronized(channel, event)
                break
            // PullRequestReviewEvent...
            case 'submitted':
                await this.handlePrReviewSubmitted(channel, event)
                break
            // IssueCommentCreatedEvent or PullRequestReviewCommentCreatedEvent...
            case 'created':
                if ((event as object).hasOwnProperty('issue')) {
                    event = event as IssueCommentCreatedEvent
                    await this.handleTopLevelCommentCreated(channel, event)
                } else {
                    event = event as PullRequestReviewCommentCreatedEvent
                    // We don't do anything with comments.
                }
                break
            default:
                // Unknown...
                console.info(`Ignoring event of type:`, event.action)
                break
        }
    }

    private async handleTopLevelCommentCreated(channel: string, event: IssueCommentCreatedEvent) {
        const prUrl = event.issue.pull_request?.url
        const isDraft = event.issue.draft ?? false // to be safe? idk. it shouldn't be undefined
        if (typeof prUrl === 'string') {
            await this.handleCommentSubmitted(channel, { url: prUrl, draft: isDraft }, event, CommentAction.COMMENT)
        }
    }

    private async handlePrConvertedToDraft(channel: string, event: PullRequestConvertedToDraftEvent) {
        await this.onPrThread(channel, event, async (pr, prevTs) => {
            const update = this.io.updateMessage(channel, prevTs, `:see_no_evil: DRAFT PR <${pr.html_url}|#${pr.number}: ${pr.title}> (+${pr.additions}/-${pr.deletions}) by ${event.sender.login}`)
            const send = this.io.sendMessage(channel, ":see_no_evil: PR has been converted to draft", prevTs)
            await Promise.all([update, send])
        })
    }

    private async handlePrReadyForReview(channel: string, event: PullRequestReadyForReviewEvent) {
        await this.onPrThread(channel, event, async (pr, prevTs) => {
            const update = this.io.updateMessage(channel, prevTs, `:pull-request: PR <${pr.html_url}|#${pr.number}: ${pr.title}> (+${pr.additions}/-${pr.deletions}) by ${event.sender.login}`)
            const send = this.io.sendMessage(channel, ":pull-request: PR is ready for review", prevTs)
            // clear the lastCommenter, if there is one; it's considered a fresh line of commenting
            let clearLastCommenter: any
            const lastCommenterKey = prLastCommenterThreadKey(channel, event)
            if (lastCommenterKey !== undefined) {
                clearLastCommenter = this.io.store.lastCommenter.set(lastCommenterKey, "")
            }
            await Promise.all([update, send, clearLastCommenter])
        })
    }

    private async handlePrReviewSubmitted(channel: string, event: PullRequestReviewSubmittedEvent) {
        if (event.pull_request.draft) {
            console.log('ignoring PR because it is in draft mode')
            return
        }
        var action: CommentAction
        switch (event.review.state) {
            case 'approved':
                action = CommentAction.APPROVE
                break
            case 'commented':
                action = CommentAction.COMMENT
                break
            case 'changes_requested':
                action = CommentAction.REQUEST_CHANGES
                break
        }
        await this.handleCommentSubmitted(channel, event.pull_request, event, action)
    }

    private async handlePrOpened(channel: string, event: PullRequestOpenedEvent) {
        console.log('handling open event')
        let pr = event.pull_request
        const header = pr.draft ? ":see_no_evil: DRAFT" : ":pull-request:"
        let ts = await this.io.sendMessage(channel, `${header} PR <${pr.html_url}|#${pr.number}: ${pr.title}> (+${pr.additions}/-${pr.deletions}) by ${event.sender.login}`)
        await this.io.store.prThreads.set(prThreadKey(channel, pr), ts)
        let content = (pr.body == null) ? "No description provided" : `PR description:\n${quote(pr.body)}`
        await this.io.sendMessage(channel, content, ts)
    }

    private async handlePrClosed(channel: string, event: PullRequestClosedEvent) {
        console.log('handling close event')
        await this.onPrThread(channel, event, async (pr, prevTs) => {
            let mergeVerb = event.pull_request.merged ? 'merged' : 'closed'
            let emoji = `:${mergeVerb}:`
            let updateTopLevelMessage = this.io.updateMessage(channel, prevTs, `${emoji} ~PR <${pr.html_url}|#${pr.number}: ${pr.title}> (+${pr.additions}/-${pr.deletions}) by ${event.sender.login}~`)
            let postToThread = this.io.sendMessage(channel, `${emoji} PR was ${mergeVerb} by ${event.sender.login}`, prevTs)
            await Promise.all([updateTopLevelMessage, postToThread])
        })
    }

    private async handlePrSynchronized(channel: string, event: PullRequestSynchronizeEvent) {
        console.log('handling sync case')
        if (event.pull_request.draft) {
            console.log('ignoring PR because it is in draft mode')
            return
        }
        await this.onPrThread(channel, event, async (pr, thread_ts) => {
            let syncEvent = event as PullRequestSynchronizeEvent
            let beforeShort = syncEvent.before
            let afterShort = syncEvent.after
            for (let i = 7; i < Math.min(syncEvent.before.length, syncEvent.after.length); ++i) {
                beforeShort = syncEvent.before.substring(0, i)
                afterShort = syncEvent.after.substring(0, i)
                if (beforeShort != afterShort) {
                    break
                }
            }
            let msg = `PR updated: <${pr.html_url}/files/${syncEvent.before}..${syncEvent.after}|${beforeShort}..${afterShort}>`
            await this.io.sendMessage(channel, msg, thread_ts)
        })
    }

    private async onPrThread(channel: string, event: PullRequestEvent, action: (pr: PullRequest, thread_ts: string) => Promise<void>) {
        let pr = event.pull_request
        let thread_ts = await this.io.store.prThreads.get(prThreadKey(channel, pr))
        if (typeof thread_ts === 'string') {
            await action(pr, thread_ts)
        } else {
            console.warn("no previous ts found for pr", pr)
        }
    }

    private async handleCommentSubmitted(channel: string, pr: PullRequestUrlProvider, event: IssueCommentCreatedEvent | PullRequestReviewSubmittedEvent, action: CommentAction) {
        if (pr.draft) {
            console.log('ignoring PR because it is in draft mode', pr.url)
            return
        }
        let thread_ts = await this.io.store.prThreads.get(prThreadKey(channel, pr))
        if (thread_ts === undefined) {
            console.warn("no previous ts found for pr", pr)
            return
        }

        const lastCommenterKey = prLastCommenterThreadKey(channel, event)
        const commentAuthor = event.sender.login
        let message: string
        switch (action) {
            case CommentAction.APPROVE:
                message = `:approved: ${event.sender.login} approved the PR (possibly with comments).`
                break
            case CommentAction.COMMENT:
                if (lastCommenterKey === undefined) {
                    console.info("No handler for action=", event.action)
                    return
                }
                const lastCommenter = await this.io.store.lastCommenter.get(lastCommenterKey)
                if (lastCommenter === commentAuthor) {
                    console.info("Ignoring event because current commenter is last commenter", commentAuthor)
                    return
                }
                message = `:reviewed: ${event.sender.login} commented on the PR.`
                break
            case CommentAction.REQUEST_CHANGES:
                message = `:requested-changes: ${event.sender.login} requested changes.`
                break
        }
        await this.io.sendMessage(channel, message, thread_ts)
        if (lastCommenterKey === undefined) {
            console.warn("Couldn't determine lastCommenterKey; future comments by the same author won't be deduped")
        } else {
            await this.io.store.lastCommenter.set(lastCommenterKey, commentAuthor)
        }
    }

    private async getBannedGithubLogins(): Promise<string[]> {
        // will eventually be configurable
        return Promise.resolve(["github-actions[bot]"])
    }
}

/**
 * The key to store in `SlackIO.store`, whose value corresponds to a PR's thread in slack.
 */
export function prThreadKey(channel: string, pr: PullRequestUrlProvider): string {
    return `pr_thread_${channel}_${pr.url}`
}

/**
 * The key to store in `SlackIO.store`, whose value corresponds to the last commenter on a PR.
 */
export function prLastCommenterThreadKey(channel: string, event: IssueCommentEvent | PullRequestReviewEvent | PullRequestReadyForReviewEvent): string | undefined {
    let prUrl: string | undefined
    // IssueCommentEvent
    if (event.action === 'edited') {
        // It's ambiguous whether this is an IssueCommentEvent or PullRequestReviewEvent. We don't need this yet, so just drop it.
        console.warn("Can't handle action=edited because it is ambiguous")
        return undefined
    }
    if (event.action === 'submitted' || event.action === 'dismissed' || event.action === 'ready_for_review') {
        prUrl = event.pull_request.url
    } else {
        prUrl = event.issue.pull_request?.url
    }
    if (prUrl === undefined) {
        return undefined
    } else {
        return `${channel}_${prUrl}`
    }
}
export interface SlackStore {
    readonly prThreads: Map<string, string | undefined>
    readonly lastCommenter: Map<string, string>
}

export interface SlackIO {
    readonly store: SlackStore
    readonly sendMessage: (channel: string, text: string, thread_ts?: string) => Promise<string | undefined>
    readonly updateMessage: (channel: string, ts: string, text: string) => Promise<void>
}

export function quote(text: string): string {
    let lines = text.split("\n")
    for (let i in lines) {
        lines[i] = `> ${lines[i]}`
    }
    return lines.join("\n")
}

function createRealIO(): SlackIO {
    let clientPromise = secretsFs.readFile("slack_token").then(buf => {
        let token = buf.toString('utf-8')
        return new WebClient(token)
    })
    return {
        store: {
            prThreads: prThreads,
            lastCommenter: lastCommenter,
        },

        async sendMessage(channel, text, thread_ts?): Promise<string | undefined> {
            let client = await clientPromise;
            console.log(`posting message to channel=${channel}, ts=${thread_ts}: ${text}`)
            let response = await client.chat.postMessage({
                channel: channel,
                text: text,
                mrkdwn: true,
                thread_ts: thread_ts,
            })
            return response.ts
        },

        async updateMessage(channel: string, ts: string, text: string): Promise<void> {
            let client = await clientPromise;
            await client.chat.update({ channel: channel, ts: ts, text: text })
        },
    }
}

enum CommentAction {
    APPROVE,
    COMMENT,
    REQUEST_CHANGES,
}

interface PullRequestUrlWrapper {
    url: string
    draft: boolean
}

type PullRequestUrlProvider =
    | PullRequest
    | SimplePullRequest
    | PullRequestUrlWrapper
    ;

