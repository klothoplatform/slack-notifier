import { PullRequest, PullRequestEvent, PullRequestSynchronizeEvent } from '@octokit/webhooks-types';
import { WebClient } from '@slack/web-api'

/**
 * @klotho::persist {
 *  id = "security-tokens"
 *  secret = true
 * }
 */
import secretsFs = require("fs/promises");
/**
 * @klotho::persist {
 *   id = "slack_ids"
 * }
 */
let kvStore = new Map<string, string | undefined>()

export class Slack {

    private io: SlackIO

    constructor(io?: SlackIO) {
        this.io = io ?? createRealIO()
    }

    async handlePrEvent(channel: string, event: PullRequestEvent) {
        let pr = event.pull_request
        let handler = new Map([
            ['opened', this.handlePrOpened],
            ['closed', this.handlePrClosed],
            ['synchronize', this.handlePrSynchronized],
        ]).get(event.action)
        if (handler === undefined) {
            console.warn(`Don't know how to handle events of type`, event.action)
            return
        }
        await handler.call(this, channel, event)
        console.log("request complete")
    }

    private async handlePrOpened(channel: string, event: PullRequestEvent) {
        console.log('handling open event')
        let pr = event.pull_request
        let ts = await this.io.sendMessage(channel, `:pull-request: PR <${pr.html_url}|#${pr.number}: ${pr.title}> (+${pr.additions}/-${pr.deletions}) by ${event.sender.login}`)
        await this.io.store.set(prThreadKey(channel, pr), ts)
        let content = (pr.body == null) ? "No description provided" : `PR description:\n${quote(pr.body)}`
        await this.io.sendMessage(channel, content, ts)
    }

    private async handlePrClosed(channel: string, event: PullRequestEvent) {
        console.log('handling close event')
        await this.onPrThread(channel, event, async (pr, prevTs) => {
            let mergeVerb = event.pull_request.merged ? 'merged' : 'closed'
            let emoji = `:${mergeVerb}:`
            let updateTopLevelMessage = this.io.updateMessage(channel, prevTs, `${emoji} ~PR <${pr.html_url}|#${pr.number}: ${pr.title}> (+${pr.additions}/-${pr.deletions}) by ${event.sender.login}~`)
            let postToThread = this.io.sendMessage(channel, `${emoji} PR was ${mergeVerb} by ${event.sender.login}`, prevTs)
            await Promise.all([updateTopLevelMessage, postToThread])
        })
    }

    private async handlePrSynchronized(channel: string, event: PullRequestEvent) {
        console.log('handling sync case')
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
        let thread_ts = await this.io.store.get(prThreadKey(channel, pr))
        if (typeof thread_ts === 'string') {
            await action(pr, thread_ts)
        } else {
            console.warn("no previous ts found for pr", pr)
        }
    }
}

/**
 * The key to store in `SlackIO.store`, whose value corresponds to a PR's thread in slack.
 */
export function prThreadKey(channel: string, pr: PullRequest): string {
    return `pr_thread_${channel}_${pr.url}`
}

export interface SlackIO {
    readonly store: Map<string, string | undefined>
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
        store: kvStore,

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
            await client.chat.update({channel: channel, ts: ts, text: text})
        },
    }
}

