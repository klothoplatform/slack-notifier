import {handleSlashCommand, parseEmojiCommand} from '../src/slack-commands'


test.each([
    {given: "emoji", want: 'describe'},
    {given: "emoji :foo:", want: {image: ":foo:"}},
    {given: "emoji :foo: :bar:", want: {err: "Command may contain one optional `:image:`, and nothing else."}},
    {given: "emoji junk", want: {err: "Command may contain one optional `:image:`, and nothing else."}},
    {given: "emoji :foo: :bar: junk", want: {err: "Command may contain one optional `:image:`, and nothing else."}},
])("'emoji' parse: %s", ({given, want}) => {
    const actual = parseEmojiCommand(given)
    expect(actual).toEqual(want)
})

test("describe all emoji", async () => {
    const actual = await handleSlashCommand("/myklotho", "emoji")
    const expectedString = [
        '*Current emoji:*',
        '',
        ':eight_pointed_black_star: Pull request opened',
        ':rocket: Pull request merged',
        ':x: Pull request closed without merging',
        ':see_no_evil: Pull request converted to draft',
        ':white_check_mark: Pull request approved',
        ':exclamation: Pull request had changes requested',
        ':speech_balloon: Pull request had comments',
        '',
        'To change one, do: `/myklotho emoji :new-emoji:`',
    ].join("\n")
    expect(actual).toEqual({
        mrkdwn: true,
        text: expectedString,
    })
})

test("configure :hat:", async () => {
    const actual = await handleSlashCommand("/test", "emoji :hat:")
    const want = {
        blocks: [
            expectedEmojiOptionsMenu({forEmoji: ':hat:'}),
        ],
    };
    expect(actual).toEqual(want)
})

function expectedEmojiOptionsMenu(options: {forEmoji: string}) {
    const menuOptions = [
        ['pr_opened', 'Pull request opened'],
        ['pr_merged', 'Pull request merged'],
        ['pr_closed', 'Pull request closed without merging'],
        ['pr_draft', 'Pull request converted to draft'],
        ['comment_approved', 'Pull request approved'],
        ['comment_changes_requested', 'Pull request had changes requested'],
        ['comment_posted', 'Pull request had comments'],
    ]
    const optionBlocks = menuOptions.map(o => {
        return {
            value: o[0],
            text: {
                type: "plain_text",
                text: o[1]
            },
        }
    })
    return {
        accessory: {
            action_id: "configure_emoji",
            options: optionBlocks,
            placeholder: {
                text: "Select an event",
                type: "plain_text"
            },
            type: "static_select"
        },
        block_id: options.forEmoji,
        text: {
            text: `Set which GitHub event to use for ${options.forEmoji}`,
            type: "mrkdwn"
        },
        type: "section"
    }
}

