import * as gh from '@octokit/webhooks-types';
import * as slack from '../src/slack'
import { createMock } from 'ts-auto-mock';

describe('GH to slack formatting', () => {
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
})

describe.each([
  [true],
  [false],
])("handle events: draft=%s", (isDraft) => {
  // "alias" notDraft to !isDraft. The non-draft behavior is what often feels like the more mainstream/natural behavior,
  // so this lets us write tests afferming the common (if readyToReview) instead of either afferming the uncommon path
  // (if isDraft) or its negation (if !isDraft).
  const readyToReview = !isDraft
  describe.each([
    [
      null,
      "No description provided",
    ],
    [
      "My PR description",
      "PR description:\n> My PR description"
    ]
  ])("new PR", (prDescription, expectComment) => {

    test(`body ${typeof (prDescription) === 'string' ? 'not' : 'is'} null`, async () => {
      let io = new MockIO()
      let client = new slack.Slack(io)
      let request = createMock<gh.PullRequestOpenedEvent>()
      request.pull_request = {
        ...request.pull_request,
        number: 123,
        title: "My Cool Title",
        html_url: "pr-url",
        body: prDescription,
        additions: 111,
        deletions: 222,
        draft: isDraft,
      }
      request.sender.login = "eagle"
      await client.handleEvent("mychannel", request)
      const expectPost = readyToReview
        ? ':pull-request: PR <pr-url|#123: My Cool Title> (+111/-222) by eagle'
        : ':see_no_evil: DRAFT PR <pr-url|#123: My Cool Title> (+111/-222) by eagle'
      io.check({
        messagesSent: [
          ['mychannel', expectPost],
          ['mychannel', expectComment, 'ts_0'],
        ],
        messagesUpdated: [],
        lastCommenter: new Map(),
      })
    })

  })

  describe.each([
    ["normal", "abcdef1234567890", "1234567890abcdef", "https://example.com/pr/123/files/abcdef1234567890..1234567890abcdef", "abcdef1..1234567"],
    ["similar commit SHAs", "1234567890aaa", "1234567890bbb", "https://example.com/pr/123/files/1234567890aaa..1234567890bbb", "1234567890a..1234567890b"],
  ])("sync PR", (name, beforeSha, afterSha, wantUrl, wantLinkText) => {
    test(name, async () => {
      let io = new MockIO()
      let client = new slack.Slack(io)
      let request = createMock<gh.PullRequestSynchronizeEvent>({
        before: beforeSha,
        after: afterSha,
      })
      request.pull_request = {
        ...request.pull_request,
        url: "https://api.example.com/pr/123",
        html_url: "https://example.com/pr/123",
        draft: isDraft,
      }
      io.store.prThreads.set(slack.prThreadKey("mychannel", request.pull_request), "t0")
      await client.handleEvent("mychannel", request)
      io.check({
        messagesSent: readyToReview
          ? [['mychannel', `PR updated: <${wantUrl}|${wantLinkText}>`, "t0"]]
          : [],
        messagesUpdated: [],
        lastCommenter: new Map(),
      })
    })
  })

  if (isDraft) {
    // "PR converted to draft" and "PR ready to review" each have an implicit value for isDraft
    test("PR converted to draft", async () => {
      const io = new MockIO()
      const client = new slack.Slack(io)
      const request = createMock<gh.PullRequestConvertedToDraftEvent>()
      request.pull_request = {
        ...request.pull_request,
        number: 123,
        title: "My PR",
        additions: 222,
        deletions: 333,
        html_url: "https://example.com/pr/123",
      }
      request.sender.login = "eagle"
      io.store.prThreads.set(slack.prThreadKey("mychannel", request.pull_request), "t0")
      await client.handleEvent("mychannel", request)
      io.check({
        messagesSent: [['mychannel', ":see_no_evil: PR has been converted to draft", 't0']],
        messagesUpdated: [['mychannel', 't0', ':see_no_evil: DRAFT PR <https://example.com/pr/123|#123: My PR> (+222/-333) by eagle']],
        lastCommenter: new Map(),
      })
    })

  } else {
    test("PR ready to review", async () => {
      const io = new MockIO()
      const client = new slack.Slack(io)
      const request = createMock<gh.PullRequestReadyForReviewEvent>()
      request.pull_request = {
        ...request.pull_request,
        number: 123,
        title: "My PR",
        additions: 222,
        deletions: 333,
        url: "https://api.example.com/pr/123",
        html_url: "https://example.com/pr/123",
      }
      request.sender.login = "eagle"
      io.store.prThreads.set(slack.prThreadKey("mychannel", request.pull_request), "t0")
      await client.handleEvent("mychannel", request)
      io.check({
        messagesSent: [['mychannel', ":pull-request: PR is ready for review", 't0']],
        messagesUpdated: [['mychannel', 't0', ':pull-request: PR <https://example.com/pr/123|#123: My PR> (+222/-333) by eagle']],
        lastCommenter: new Map([
          [{ channel: 'mychannel', pr_url: 'https://api.example.com/pr/123' }, ''] // resets the lastCommenter for this channel + pr
        ]),
      })
    })
  }

  describe.each([true, false])("comment", (afterSameUserJustCommented) => {
    describe.each([
      // e.g.: "for top-level comments (===undefined)", if this message was after the same user just commented or if this PR is in draft,
      // expect no messages; otherwise, expect a single message saying that eagle commented on the PR"
      [undefined, afterSameUserJustCommented || isDraft ? [] : [":reviewed: eagle commented on the PR."]],
      ["commented", afterSameUserJustCommented || isDraft ? [] : [":reviewed: eagle commented on the PR."]],
      // Changed-requested and approves always get sent for non-draft PRs, even if it was the same commenter as the last message.
      ["changes_requested", isDraft ? [] : [":requested-changes: eagle requested changes."]],
      ["approved", isDraft ? [] : [":approved: eagle approved the PR (possibly with comments)."]],
    ])(`afterSameUserJustCommented: ${afterSameUserJustCommented}`, (reviewAction, wantComment) => {
      test((reviewAction === undefined) ? "issue comment" : `PR ${reviewAction}`, async () => {
        const io = new MockIO()
        const client = new slack.Slack(io)

        if (afterSameUserJustCommented) {
          io.store.lastCommenter.set("mychannel_https://api.example.com/pr/123", "eagle")
        }

        let request: gh.PullRequestReviewSubmittedEvent | gh.IssueCommentCreatedEvent
        let pr: gh.SimplePullRequest | { url: string, draft: boolean }
        if (reviewAction == undefined) {
          request = createMock<gh.IssueCommentCreatedEvent>()
          request.issue = {
            ...request.issue,
            pull_request: {
              ...request.issue.pull_request,
              url: "https://api.example.com/pr/123",
            },
            draft: isDraft,
          }
          pr = {
            url: "https://api.example.com/pr/123",
            draft: isDraft,
          }
        } else {
          request = createMock<gh.PullRequestReviewSubmittedEvent>()
          request.review = {
            ...request.review,
            state: reviewAction as "commented" | "changes_requested" | "approved",
          }
          request.pull_request = {
            ...request.pull_request,
            draft: isDraft,
            url: "https://api.example.com/pr/123",
          }
          pr = request.pull_request
        }

        request.sender.login = "eagle"
        io.store.prThreads.set(slack.prThreadKey("mychannel", pr), "t0")
        await client.handleEvent("mychannel", request)
        const expectedLastCommenters: ExpectedLastCommenters = new Map()
        // If afterSameUserJustCommented==true, then we expect this because we set it in our test.
        // Otherwise, we expect it if we expect to send a message.
        if (afterSameUserJustCommented || wantComment.length > 0) {
          expectedLastCommenters.set({ channel: "mychannel", pr_url: "https://api.example.com/pr/123" }, "eagle")
        }
        io.check({
          messagesSent: wantComment.map(comment => ['mychannel', comment, 't0']),
          messagesUpdated: [],
          lastCommenter: expectedLastCommenters,
        })
      })
    })
  })

  describe("PR closed", () => {
    test("without merging", async () => {
      const io = new MockIO()
      const client = new slack.Slack(io)
      const request = createMock<gh.PullRequestClosedEvent>()
      request.pull_request = {
        ...request.pull_request,
        number: 123,
        title: "My PR",
        additions: 222,
        deletions: 333,
        html_url: "https://example.com/pr/123",
        merged: false,
        draft: isDraft
      }
      request.sender.login = "eagle"
      io.store.prThreads.set(slack.prThreadKey("mychannel", request.pull_request), "t0")
      await client.handleEvent("mychannel", request)
      io.check({
        messagesSent: [['mychannel', ":closed: PR was closed by eagle", 't0']],
        messagesUpdated: [['mychannel', 't0', ':closed: ~PR <https://example.com/pr/123|#123: My PR> (+222/-333) by eagle~']],
        lastCommenter: new Map(),
      })
    })

    test("merged", async () => {
      const io = new MockIO()
      const client = new slack.Slack(io)
      const request = createMock<gh.PullRequestClosedEvent>()
      request.pull_request = {
        ...request.pull_request,
        number: 123,
        title: "My PR",
        additions: 222,
        deletions: 333,
        html_url: "https://example.com/pr/123",
        merged: true,
        draft: isDraft,
      }
      request.sender.login = "eagle"
      io.store.prThreads.set(slack.prThreadKey("mychannel", request.pull_request), "t0")
      await client.handleEvent("mychannel", request)
      io.check({
        messagesSent: [['mychannel', ":merged: PR was merged by eagle", 't0']],
        messagesUpdated: [['mychannel', 't0', ':merged: ~PR <https://example.com/pr/123|#123: My PR> (+222/-333) by eagle~']],
        lastCommenter: new Map(),
      })
    })
  })
})

test("unhandled event", async () => {
  const io = new MockIO()
  const client = new slack.Slack(io)
  const request = createMock<gh.PullRequestAutoMergeEnabledEvent>()
  await client.handleEvent("mychannel", request)
  io.check({
    messagesSent: [],
    messagesUpdated: [],
    lastCommenter: new Map(),
  })
})

type ExpectedLastCommenters = Map<{ channel: string, pr_url: string }, string>

interface ExpectIO {
  messagesSent: [channel: string, text: string, thread_ts?: string][]
  messagesUpdated: [channel: string, ts: string, text: string][]
  lastCommenter: ExpectedLastCommenters
}

class MockIO implements slack.SlackIO {
  private messageCount = 0

  readonly store: slack.SlackStore
  readonly sendMessage: (channel: string, text: string, thread_ts?: string) => Promise<string | undefined>
  readonly updateMessage: (channel: string, ts: string, text: string) => Promise<void>
  readonly botId = Promise.resolve("bot_id")

  private mockSendMessage = jest.fn((channel: string, text: string, ts?: string) => Promise.resolve(`ts_${this.messageCount++}`))
  private mockUpdateMessage = jest.fn((channel: string, ts: string, text: string) => Promise.resolve())

  constructor() {
    this.store = {
      prThreads: new Map<string, string | undefined>(),
      lastCommenter: new Map<string, string>(),
    }
    this.sendMessage = this.mockSendMessage
    this.updateMessage = this.mockUpdateMessage
  }

  check(expected: ExpectIO) {
    expect(this.mockSendMessage.mock.calls).toEqual(expected.messagesSent)
    expect(this.mockUpdateMessage.mock.calls).toEqual(expected.messagesUpdated)
    const expectLastCommenterMap = new Map<string, string>()
    expected.lastCommenter.forEach((value, key) => {
      expectLastCommenterMap.set(`${key.channel}_${key.pr_url}`, value)
    })
    expect(this.store.lastCommenter).toEqual(expectLastCommenterMap)
  }
}
