import { WebClient } from '@slack/web-api'

/*
 * @klotho::persist {
 *   id = "bot_channels"
 * }
 */
const channelsByBotId = new Map<string, string[]>()

/**
 * @klotho::persist {
 *  id = "security-tokens"
 *  secret = true
 * }
 */
import secretsFs = require("fs/promises");

export async function addChannel(botId: string, channelId: string) {
    await modifyChannels(botId, current => {
        if (current.includes(channelId)) {
            console.warn("channel was already here (this may mean we missed a message, or that one has been replayed)")
        } else {
            current.push(channelId)
        }
        return current
    })
}

export async function removeChannel(botId: string, channelId: string) {
    await modifyChannels(botId, current => {
        return current.filter(val => val !== channelId)
    })
}

export async function getChannels(botId: string): Promise<string[]> {
    const current = await channelsByBotId.get(botId)
    console.log("current channels:", current)
    return current ?? []
}

async function modifyChannels(botId: string, modification: (current: string[]) => string[]) {
    const modified = modification(await getChannels(botId))
    await channelsByBotId.set(botId, modified)
    console.log("new channels", modified)
}

export async function getCreds(): Promise<SlackAppCreds> {
    let token = await secretsFs.readFile("slack_token")
    let signingSecret = await secretsFs.readFile("slack_signing_secret")
    return {
        token: token.toString(),
        signingSecret: signingSecret.toString(),
    }
}

export interface SlackAppCreds {
    token: string,
    signingSecret: string
}
