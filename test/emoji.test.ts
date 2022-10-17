/**
 * @group integration
 */

import {emojiDescriptions, EmojiStore} from '../src/emoji'

test('get defaulted value', async () => {
    const store = EmojiStore.test()
    const emoji = await store.get('pr_draft')
    expect(emoji).toBe(':see_no_evil:')
})

test('get set value', async () => {
    const store = EmojiStore.test()
    await store.set('pr_draft', ':my-whatever-emoji:')
    const emoji = await store.get('pr_draft')
    expect(emoji).toBe(':my-whatever-emoji:')
})

test('emoji description', async () => {
    const description = emojiDescriptions['pr_closed']
    expect(description).toBe('Pull request closed without merging')
})
