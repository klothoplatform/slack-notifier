import { BlockList } from 'net'
import * as slack from '../src/slack'

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