/**
 * @klotho::execution_unit {
 *   id = "slack-github"
 * }
 */

import express from 'express';
import { Slack } from './slack'
import { WebhookEvent, PullRequestEvent, PullRequestOpenedEvent, PullRequest } from "@octokit/webhooks-types";
import e from 'express';

// TODO make the following configurable
// const channelId = 'C03TAJGB12T' // #slack-notifications-demo make configurable
// const channelId = 'C02HB4GSS78' // #daily-a-sync
// const channelId = 'C02T0929PHD' // #test-channel
const channelId = 'C03RLV1M82F' // #klotho-donuts

const app = express()
const router = express.Router();
router.use(express.json())


router.post('/github', async (req: express.Request, res: express.Response) => {
    try {
        let slack = new Slack()
        let prEvent = req.body as PullRequestEvent
        await slack.handlePrEvent(channelId, prEvent)
        res.send("ok")
    } catch (e) {
        console.log("error getting users", e)
        res.status(500).send(e)
    }
});

app.use(router)

/* @klotho::expose {
 *  target = "public"
 * }
 */
app.listen(3000, async () => {
    console.log(`App listening at :3000`)
})

export { app }