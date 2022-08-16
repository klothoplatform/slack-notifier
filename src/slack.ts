import { PullRequest, PullRequestClosedEvent, PullRequestEvent, PullRequestOpenedEvent } from '@octokit/webhooks-types';
import { WebClient } from '@slack/web-api'
import { text } from 'express';

/**
 * @klotho::persist {
 *  secret = true
 * }
 */
import fs = require("fs/promises");
/**
 * @klotho::persist {
 *   name = "slack_ids"
 * }
 */
let kvStore = new Map()


export class Slack {

    private web: Promise<WebClient>;

    constructor() {
        const token = fs.readFile("slack_token")
        this.web = token.then(
            tbuf => {
                let token = tbuf.toString("utf-8")
                return new WebClient(token)
            },
            err => {
                console.error('failed to create client', err)
                throw err;
            });
    }

    async handlePrEvent(channel: string, event: PullRequestEvent) {
        let pr = event.pull_request
        switch (event.action) {
            case 'opened':
                console.log('handling open event')
                let ts = await this.sendSlackMessage(channel, `:pull-request: PR <${pr.html_url}|#${pr.number}: ${pr.title}> by ${event.sender.login}`)
                await kvStore.set(this.prThreadKey(pr), ts)
                console.log(`posted message for ${pr.url} at ${ts}`)
                let content = (pr.body == null) ? "No description provided" : `Content:\n${quote(pr.body)}`
                await this.sendSlackMessage(channel, content, ts)
                console.log('posted self-reply')
                break
            case 'closed':
                console.log('handling close event')
                let prevTs = await kvStore.get(this.prThreadKey(pr))
                if (typeof prevTs === 'string') {
                    let mergeVerb = event.pull_request.merged ? 'merged' : 'closed'
                    let emoji = `:${mergeVerb}:`

                    let client = await this.web;
                    await client.chat.update({
                        channel: channel,
                        ts: prevTs,
                        text: `${emoji} ~PR <${pr.html_url}|#${pr.number}: ${pr.title}> by ${event.sender.login}~`,
                    })
                    await this.sendSlackMessage(channel, `${emoji} PR was ${mergeVerb} by ${event.sender.login}`, prevTs)
                } else {
                    console.warn("no previous ts found for pr", pr)
                }
                break
            default:
                console.warn(`Don't know how to handle events of type`, event.action)
                break
        }
    }

    private async sendSlackMessage(channel: string, text: string, thread_ts?: string): Promise<string | undefined> {
        let client = await this.web;
        console.log(`posting message to channel=${channel}, ts=${thread_ts}: ${text}`)
        let response = await client.chat.postMessage({
            channel: channel,
            text: text,
            mrkdwn: true,
            thread_ts: thread_ts,
        })
        return response.ts
    }

    private prThreadKey(pr: PullRequest) {
        return `pr_thread_${pr.url}`
    }

}

export function quote(text: string): string {
    let lines = text.split("\n")
    for (let i in lines) {
        lines[i] = `> ${lines[i]}`
    }
    return lines.join("\n")
}

