import {
    BlockElementAction,
    DialogSubmitAction,
    InteractiveAction,
    RespondArguments,
    WorkflowStepEdit,
} from "@slack/bolt";
import {emojiDescriptions, EmojiKey, EmojiStore} from "./emoji";
import {PlainTextOption} from "@slack/types";

type Action = DialogSubmitAction | WorkflowStepEdit | InteractiveAction | BlockElementAction

export async function handleAction(action: Action): Promise<ActionResult | undefined> {
    if (action.type === 'static_select') {
        if (action.action_id === 'configure_emoji') {
            const newEmoji = action.block_id
            const forWhich = action.selected_option.value as EmojiKey
            await EmojiStore.real().set(forWhich, newEmoji)
            return {
                type: "configure_emoji",
                newValue: newEmoji,
            }
        }
    } else {
        console.log("unknown action: ", action.type)
    }
    return
}

type ActionResult =
    | ConfigureEmojiResult

interface ConfigureEmojiResult {
    type: 'configure_emoji'
    newValue: string,
}

/**
 * Parses a command that starts with "emoji".
 *
 * The command must either be just "emoji", or else contain 1 or more images of the form ":image:". It may not contain
 * anything else.
 * @param command
 */
export function parseEmojiCommand(command: String): {image: string} | {err: string} | 'describe' {
    const fullLine = command.match(/^emoji(?:\s+(?<images>:[^:]+:)?\s*(?<extra>.*))?/)
    if (fullLine === null) {
        return {err: "Unrecognized command"} // not expected!
    }
    if ((fullLine.groups?.extra ?? "").length > 0) {
        return {err: "Command may contain one optional `:image:`, and nothing else."}
    }
    if (fullLine.groups?.images === undefined) {
        return 'describe'
    }
    return {image: fullLine.groups?.images}
}

export async function describeCurrentEmoji(commandName: string): Promise<string> {
    const emojiStore = EmojiStore.real()
    const currentImages = forEachEmojiInOrder((key) => {
        const image = emojiStore.get(key)
        const description = emojiDescriptions[key]
        return {image: image, description: description}
    })
    let result = "*Current emoji:*\n\n"
    for (const {image, description} of currentImages) {
        result += `${await image} ${description}\n`
    }
    result += `\nTo change one, do: \`${commandName} emoji :new-emoji:\``
    return result
}

export async function handleSlashCommand(commandName: string, commandText: string): Promise<string | RespondArguments> {
    if (commandText.match(/^emoji\b/)) {
        const commandParse = parseEmojiCommand(commandText)
        if (commandParse === 'describe') {
            return {
                text: await describeCurrentEmoji(commandName),
                mrkdwn: true,
            }
        }
        if ('err' in commandParse) {
            return {
                text: `${commandParse.err}`,
                mrkdwn: false,
            }
        }
        const ghEventOptions: PlainTextOption[] = forEachEmojiInOrder((key) => {
            return {
                text: {
                    type: 'plain_text',
                    text: emojiDescriptions[key]
                },
                value: key,
            }
        })
        return {
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: emojiConfigurePrompt(commandParse.image),
                    },
                    accessory: {
                        type: 'static_select',
                        placeholder: {
                            type: 'plain_text',
                            text: 'Select an event',
                        },
                        options: ghEventOptions,
                        action_id: "configure_emoji",
                    },
                    block_id: commandParse.image,
                }
            ],
        }
    } else {
        return {
            text: `Unrecognized command.\nTry \`/${commandName} emoji :<emoji>:\` to configure the emoji for GitHub actions.\nFor example:\n>/${commandName} emoji :rocket:`,
            mrkdwn: true,
        }
    }
}

export function emojiConfigurePrompt(newImage: string): string {
    return `Set which GitHub event to use for ${newImage}`
}

const emojiKeyOrdering: { [key in EmojiKey]: number } = {
    "pr_opened": 0,
    "pr_merged": 1,
    "pr_closed": 2,
    "pr_draft": 3,
    "comment_approved": 4,
    "comment_changes_requested": 4,
    "comment_posted": 5,
} as const

function forEachEmojiInOrder<T>(fn: (key: EmojiKey) => T): T[] {
    let results: {key: number, result: T}[] = []
    for (const key in emojiKeyOrdering) {
        const emojiKey = key as EmojiKey
        results.push({key: emojiKeyOrdering[emojiKey], result: fn(emojiKey)})
    }
    results.sort((a, b) => {
        return a.key - b.key
    })
    return results.map(r => r.result)
}
