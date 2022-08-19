import { PullRequest, PullRequestClosedEvent, PullRequestOpenedEvent, PullRequestSynchronizeEvent } from '@octokit/webhooks-types';
import * as slack from '../src/slack'
import { createMock } from 'ts-auto-mock';

test('simple newline', () => {
  let input = `Hello
world`
  let output = `> Hello
> world`
  expect(slack.quote(input)).toBe(output)
})


test('triple-escape code block', () => {
  let input = `Code
\`\`\`
Block
\`\`\``
  let output = `> Code
> \`\`\`
> Block
> \`\`\``
  expect(slack.quote(input)).toBe(output)
})

test('indented code block', () => {
  let input = `Code

    block one

unblock`
  let output = `> Code
> 
>     block one
> 
> unblock`
  expect(slack.quote(input)).toBe(output)
})

test('new PR', async () => {
  let io = new MockIO()
  let client = new slack.Slack(io)
  let request = createMock<PullRequestOpenedEvent>()
  request.pull_request.number = 123
  request.pull_request.title = "My Cool Title"
  request.pull_request.html_url = "pr-url"
  request.pull_request.body = null
  request.sender.login = "eagle"
  await client.handlePrEvent("mychannel", request)
  expect(io.sendMessage.mock.calls).toEqual([
    ['mychannel', ':pull-request: PR <pr-url|#123: My Cool Title> by eagle'],
    ['mychannel', 'No description provided', 'ts_0'],
  ])
  expect(io.updateMessage.mock.calls).toEqual([])
})

test("sync PR",async () => {
  let io = new MockIO()
  let client = new slack.Slack(io)
  let request = createMock<PullRequestSynchronizeEvent>()
  request.before = "abcdef1234567890"
  request.after = "1234567890abcdef"
  request.pull_request.url = "https://api.example.com/pr/123"
  request.pull_request.html_url = "https://example.com/pr/123"
  io.store.set(slack.prThreadKey("mychannel", request.pull_request), "t0")
  await client.handlePrEvent("mychannel", request)
  expect(io.sendMessage.mock.calls).toEqual([
    ['mychannel', 'PR updated: <https://example.com/pr/123/files/abcdef1234567890..1234567890abcdef|abcdef1..1234567>', "t0"],
  ])
  expect(io.updateMessage.mock.calls).toEqual([])
})

/**
 * Like `sync PR`, but with the PR shas similar in their first 10 letters.
 * 
 * We should lengthen them until they're unique.
 */
test("sync PR with similar SHAs",async () => {
  let io = new MockIO()
  let client = new slack.Slack(io)
  let request = createMock<PullRequestSynchronizeEvent>()
  request.before = "1234567890aaa"
  request.after =  "1234567890bbb"
  request.pull_request.url = "https://api.example.com/pr/123"
  request.pull_request.html_url = "https://example.com/pr/123"
  io.store.set(slack.prThreadKey("mychannel", request.pull_request), "t0")
  await client.handlePrEvent("mychannel", request)
  expect(io.sendMessage.mock.calls).toEqual([
    ['mychannel', 'PR updated: <https://example.com/pr/123/files/1234567890aaa..1234567890bbb|1234567890a..1234567890b>', "t0"],
  ])
  expect(io.updateMessage.mock.calls).toEqual([])
})

class MockIO implements slack.SlackIO {
  private messageCount = 0
  store = new Map<string, string | undefined>()
  sendMessage = jest.fn((channel: string, text: string, ts?: string) => Promise.resolve(`ts_${this.messageCount++}`))
  updateMessage = jest.fn((channel: string, ts: string, text: string) => Promise.resolve())
}