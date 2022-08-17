import { PullRequest, PullRequestEvent } from '@octokit/webhooks-types';
import { WebClient } from '@slack/web-api'
import { text } from 'express';
import e = require('express');

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
        let ts = await this.io.sendMessage(channel, `:pull-request: PR <${pr.html_url}|#${pr.number}: ${pr.title}> by ${event.sender.login}`)
        await kvStore.set(this.prThreadKey(pr), ts)
        let content = (pr.body == null) ? "No description provided" : `PR description:\n${quote(pr.body)}`
        await this.io.sendMessage(channel, content, ts)
    }

    private async handlePrClosed(channel: string, event: PullRequestEvent) {
        console.log('handling close event')
        let pr = event.pull_request
        let prevTs = await kvStore.get(this.prThreadKey(pr))
        if (typeof prevTs === 'string') {
            let mergeVerb = event.pull_request.merged ? 'merged' : 'closed'
            let emoji = `:${mergeVerb}:`
            let updateTopLevelMessage = this.io.updateMessage( channel, prevTs, `${emoji} ~PR <${pr.html_url}|#${pr.number}: ${pr.title}> by ${event.sender.login}~`)
            let postToThread = this.io.sendMessage(channel, `${emoji} PR was ${mergeVerb} by ${event.sender.login}`, prevTs)
            await Promise.all([updateTopLevelMessage, postToThread])
        } else {
            console.warn("no previous ts found for pr", pr)
        }
    }

    private prThreadKey(pr: PullRequest) {
        return `pr_thread_${pr.url}`
    }
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
    let clientPromise = fs.readFile("slack_token").then(buf => {
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

