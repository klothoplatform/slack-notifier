/*
 * @klotho::persist {
 *   id = "emoji"
 * }
 */
let emojiStore = new Map<EmojiKey, string>()

export class EmojiStore {
    private readonly backing: Map<EmojiKey, string>
    
    static real(): EmojiStore {
        return new EmojiStore(emojiStore)
    }

    static test(): EmojiStore {
        return new EmojiStore(new Map())
    }

    private constructor(backing: Map<EmojiKey, string>) {
        this.backing = backing
    }

    async set(key: EmojiKey, value: string) {
        await this.backing.set(key, value)
    }

    async get(key: EmojiKey): Promise<string> {
        let resolved = await this.backing.get(key)
        if (resolved === undefined) {
            resolved = EmojiStore.defaultEmoji[key]
        }
        if (resolved === undefined) {
            resolved = ':robot_face:'
        }
        return resolved
    }

    private static readonly defaultEmoji: EmojiValues = {
        pr_opened: ':eight_pointed_black_star:',
        pr_merged: ':rocket:',
        pr_closed: ':x:',
        pr_draft: ':see_no_evil:',
        comment_approved: ':white_check_mark:',
        comment_changes_requested: ':exclamation:',
        comment_posted: ':speech_balloon:',
    }
}

export type PrEmoji = 'opened' | 'merged' | 'closed' | 'draft'
export type CommentEmoji = 'approved' | 'changes_requested' | 'posted'

export type EmojiKey =
    | `pr_${PrEmoji}`
    | `comment_${CommentEmoji}`

type EmojiValues = {
    [Key in EmojiKey]: string
}

export const emojiDescriptions: EmojiValues = {
    pr_opened: "Pull request opened",
    pr_merged: "Pull request merged",
    pr_closed: "Pull request closed without merging",
    pr_draft: "Pull request converted to draft",
    comment_approved: "Pull request approved",
    comment_changes_requested: "Pull request had changes requested",
    comment_posted: "Pull request had comments",
} as const
