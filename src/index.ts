/**
 * @klotho::execution_unit {
 *   id = "slack-github"
 * }
 */

import express from 'express';
import { Slack } from './slack'
import { PullRequestEvent } from "@octokit/webhooks-types";

const channelId = 'C03RLV1M82F' // #klotho-donuts

const app = express()
const router = express.Router();
router.use(express.json())

let slack = new Slack()

router.post('/github', async (req: express.Request, res: express.Response) => {
    try {
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
    id = "gh-webhook"
 *  target = "public"
 * }
 */
app.listen(3000, async () => {
    console.log(`App listening at :3000`)
})

export { app }