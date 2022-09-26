/**
 * @klotho::execution_unit {
 *   id = "slack-listener"
 * }
 */

import express = require('express')
import * as SlackBolt from '@slack/bolt'
import { WebClient } from '@slack/web-api'
import { StringIndexed } from '@slack/bolt/dist/types/helpers'
import { addChannel, getCreds, removeChannel } from './slack-common'
import {emojiConfigurePrompt, handleAction, handleSlashCommand} from "./slack-commands";
import {emojiDescriptions} from "./emoji";

/**
 * @klotho::persist {
 *   id = "slack_channel_events"
 * }
 */
const slackChannelEvent = new Map<string, number>()

class SimpleReceiver {
    private readonly bolt = getCreds().then(async creds => {
        const bolt = new SlackBolt.App({
            ...creds
        })
        this.boltInit(bolt)
        return bolt
    })

    private readonly boltInit: (bolt: SlackBolt.App<StringIndexed>) => void
    private readonly handlersChain: ((body: object, res: express.Response) => Promise<boolean>)[]

    constructor(boltInit: (bolt: SlackBolt.App<StringIndexed>) => void) {
        this.boltInit = boltInit
        this.handlersChain = [
            this.handleUrlVerification,
            this.handleEvent,
        ]
        for (const i in this.handlersChain) {
            this.handlersChain[i] = this.handlersChain[i].bind(this)
        }
    }

    async requestHandler(req: express.Request, res: express.Response): Promise<void> {
        let body = this.parseBody(req)
        for (const handler of this.handlersChain) {
            if (await handler(body, res)) {
                return
            }
        }
        throw Error("no handler found")
    }

    private async handleUrlVerification(body: object, res: express.Response): Promise<boolean> {
        interface UrlVerificationChallenge {
            token: string,
            challenge: string,
            type: 'url_verification',
        }
        const challenge = body as (UrlVerificationChallenge | {type: undefined})
        if (challenge.type === 'url_verification') {
            console.log('responding to URL verification challenge')
            res.json({ challenge: challenge.challenge });
            return true
        }
        return false
    }

    private async handleEvent(body: object, res: express.Response): Promise<boolean> {
        console.info("handling slack event", body)
        let ackCalled = false;
        const event: SlackBolt.ReceiverEvent = {
          body: body,
          // Receivers are responsible for handling acknowledgements
          // `ack` should be prepared to be called multiple times and 
          // possibly with `response` as an error
          ack: async (response) => {
            if (response === undefined) {
                // For events, we need to not do anything, and hold off on the response until
                // the processEvent itself is complete. Otherwise, AWS Lambda will kill us off early.
                console.debug("undefined ack")
                return
            }
            console.log("ack invoked with response: ", JSON.stringify(response))
            if (ackCalled) {
              return;
            }
            
            if (response instanceof Error) {
              res.status(500).send();
            } else if (!response) {
              res.send('')
            } else {
              res.send(response);
            }
            
            ackCalled = true;
          },
        }
        try {
            const bolt = await this.bolt
            await bolt.processEvent(event);
            console.log("processEvent promise complete")
            res.send()
        } catch (e) {
            console.error("processEvent failed", e)
            res.status(500).send()
        }
        return true
    }

    private parseBody(req: express.Request): any {
        if (Buffer.isBuffer(req.body)) {
            req.body = (req.body as Buffer).toString()
        }
        switch (req.headers['content-type']) {
            case 'application/x-www-form-urlencoded':
                console.log('parsing as x-www-form-urlencoded')
                const urlParams = new URLSearchParams(req.body as string)
                const payload = urlParams.get('payload')
                if (typeof payload === 'string') {
                    return JSON.parse(payload)
                }
                let  result: any = {}
                for (const [k, v] of urlParams.entries()) {
                    result[k] = v
                }
                return result
            case 'application/json':
                if (typeof req.body === 'string') {
                    console.log('parsing as json')
                    return JSON.parse(req.body)
                }
                return req.body
            default:
                console.error("couldn't find acceptable content type:", req.headers['content-type'])
                throw new Error("couldn't find acceptable content type");
        }
    }
}

const simple = new SimpleReceiver((bolt) => {
    bolt.event('member_joined_channel', async ({event, client, logger}) => {
        if ((await channelMembershipEventAlreadyHandled(event)) ?? true) {
            return
        }
        await withBotId(client, async (botId, userId) => {
            if (event.user == userId) {
                await addChannel(botId, event.channel)
            }
        })
    })
    bolt.event('channel_left', async ({event, client, logger}) => {
        if (await channelMembershipEventAlreadyHandled(event)) {
            return
        }
        await withBotId(client, async (botId) => {
            await removeChannel(botId, event.channel)
        })
    })
    bolt.event('group_left', async ({event, client, logger}) => {
        if (await channelMembershipEventAlreadyHandled(event)) {
            return
        }
        await withBotId(client, async (botId) => {
            await removeChannel(botId, event.channel)
        })
    })
    bolt.action(/.*/, async ({payload, action, body, ack, respond}) => {
        const actionResult = await handleAction(action)
        let response: SlackBolt.RespondArguments = {
            text: "There may have been an error, but I'm not sure. Try to confirm whether your action took effect.",
            response_type: "ephemeral",
        }
        switch (actionResult?.type) {
            case 'configure_emoji':
                response = {
                    replace_original: true,
                    blocks: [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: emojiConfigurePrompt(actionResult?.newValue),
                            }
                        },
                        {
                          type: 'context',
                          elements: [
                              {
                                  type: 'plain_text',
                                  text: 'Success',
                              }
                          ]
                        },
                    ],
                }
            break
        }
        await respond(response)
        await ack()
    })
    bolt.command(/.*/, async ({command, ack}) => {
        const result = await handleSlashCommand(command.command, command.text)
        await ack(result)
    })
})
export const router = express.Router()
router.post('/slack', simple.requestHandler.bind(simple))

async function withBotId(client: WebClient, run: (botId: string, botUserId: string | undefined) => Promise<void>): Promise<void> {
    const authCheck = await client.auth.test({
        token: client.token,
    })
    const thisBotId = authCheck.bot_id
    console.log(`got bot_id=${thisBotId} user_id=${authCheck.user_id}` , authCheck)
    if (thisBotId === undefined) {
        console.error("couldn't determine bot id; ignoring message")
        return
    }
    return run(thisBotId, authCheck.user_id)
}

async function channelMembershipEventAlreadyHandled(event: {event_ts: string, channel: string}): Promise<boolean | undefined> {
    const alreadyHandled = await slackChannelEvent.get(event.channel)
    if (alreadyHandled == undefined) {
        return false
    }
    const eventTime = parseFloat(event.event_ts)
    if (isNaN(eventTime)) {
        console.warn("couldn't parse event time; assuming event was already handled:", eventTime)
        return undefined
    }
    if (eventTime <= alreadyHandled) {
        console.info('event was already handled at t=', alreadyHandled)
        return true
    }
    await slackChannelEvent.set(event.channel, eventTime)
    return false
}
