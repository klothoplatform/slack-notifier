import express = require('express')
import { router as ghListener } from './github-listener'
import { router as slackListener } from './slack-listener'

const app = express()

app.use(ghListener)
app.use(slackListener)

/* @klotho::expose {
    id = "gh-webhook"
 *  target = "public"
 * }
 */
app.listen(3000, async () => {
    console.log(`App listening at :3000`)
})

export { app }
