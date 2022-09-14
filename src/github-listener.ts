/**
 * @klotho::execution_unit {
 *   id = "github-listener"
 * }
 */

import express from 'express';
import { Slack } from './slack'
import { IssueCommentEvent, PullRequestEvent } from "@octokit/webhooks-types";
import { getChannels } from './slack-common';

export const router = express.Router();
router.use(express.json())

let slack = new Slack()

router.post('/github', async (req: express.Request, res: express.Response) => {
    try {
        let event = req.body as (PullRequestEvent | IssueCommentEvent)
        let botId = await slack.botId
        if (botId === undefined) {
            throw Error("Couldn't look up botId, which I need to look up what channels I'm in")
        }
        let channels = await getChannels(botId)
        const eventPromises: Promise<void>[] = []
        for (const channelId of channels) {
            eventPromises.push(slack.handleEvent(channelId, event))
        }
        await Promise.all(eventPromises)
        res.send("ok")
    } catch (e) {
        console.error(e)
        res.status(500).send(e)
    }
});
