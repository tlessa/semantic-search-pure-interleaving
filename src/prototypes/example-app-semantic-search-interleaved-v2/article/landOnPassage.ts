/**
 * Land a reader on the passage that answered their semantic search: find the answer
 * text in the rendered article, highlight it and scroll it to the middle of the screen.
 * Falls back to the passage's section heading when the text can't be matched.
 */

export const ANSWER_MARK_CLASS = 'semantic-search-answer'

/** Blocks searched for the answer, in order: prose first, then lists, then tables. */
const BLOCK_GROUPS = ['p', 'li, dd, blockquote, figcaption', 'td, th']

/** Text the search index never saw: footnote markers, edit links, inline styles. */
const SKIP_SELECTOR =
  'sup.reference, .mw-ref, .mw-editsection, .pcs-edit-section-link-container, style, script'

/**
 * The article may live in another document (the app view's frame), out of reach of
 * this app's CSS, so the highlight brings its own style. Same yellow as v2's cards.
 */
const ANSWER_STYLE = `
.${ANSWER_MARK_CLASS} {
  border-radius: 2px;
  background-color: #fdf2d5;
  color: inherit;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.pcs-theme-dark .${ANSWER_MARK_CLASS},
.pcs-theme-black .${ANSWER_MARK_CLASS} {
  background-color: #4a3e1d;
}
`

function injectAnswerStyle(doc: Document): void {
  if (doc.getElementById(`${ANSWER_MARK_CLASS}-style`)) return
  const style = doc.createElement('style')
  style.id = `${ANSWER_MARK_CLASS}-style`
  style.textContent = ANSWER_STYLE
  doc.head.appendChild(style)
}

interface IndexedText {
  /**
   * Lowercased text with all whitespace dropped: snippets space things differently
   * from the article (e.g. "short- wavelength" for "short-wavelength").
   */
  text: string
  /** For each character of `text`, where it came from in the DOM. */
  positions: Array<{ node: Text; offset: number }>
}

function compact(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function indexText(element: Element): IndexedText {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })

  let text = ''
  const positions: IndexedText['positions'] = []

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let offset = 0; offset < node.data.length; offset++) {
      const char = node.data[offset]
      if (/\s/.test(char)) continue
      for (const lower of char.toLocaleLowerCase()) {
        text += lower
        positions.push({ node, offset })
      }
    }
  }

  return { text, positions }
}

/** Wrap characters `start`–`end` of `indexed` in marks, one per text node they span. */
function markRange(indexed: IndexedText, start: number, end: number): HTMLElement[] {
  const spans = new Map<Text, { from: number; to: number }>()
  for (const { node, offset } of indexed.positions.slice(start, end)) {
    const span = spans.get(node)
    if (span) span.to = offset + 1
    else spans.set(node, { from: offset, to: offset + 1 })
  }

  const entries = [...spans]
  return entries.map(([node, { from, to }], i) => {
    // Whitespace at a link edge belongs to the answer: keep the highlight unbroken.
    if (i > 0 && !node.data.slice(0, from).trim()) from = 0
    if (i < entries.length - 1 && !node.data.slice(to).trim()) to = node.data.length
    const middle = node.splitText(from)
    middle.splitText(to - from)
    const mark = node.ownerDocument.createElement('mark')
    mark.className = ANSWER_MARK_CLASS
    middle.replaceWith(mark)
    mark.appendChild(middle)
    return mark
  })
}

/** The full answer, then its first half: snippets and article text can drift apart. */
function needles(answer: string): string[] {
  const words = normalize(answer).split(' ')
  const full = compact(answer)
  const half = compact(words.slice(0, Math.ceil(words.length / 2)).join(''))
  return words.length >= 8 ? [full, half] : [full]
}

function findAnswer(root: HTMLElement, answer: string): HTMLElement[] {
  for (const needle of needles(answer)) {
    if (!needle) continue
    for (const selector of BLOCK_GROUPS) {
      for (const block of root.querySelectorAll(selector)) {
        const indexed = indexText(block)
        const start = indexed.text.indexOf(needle)
        if (start !== -1) return markRange(indexed, start, start + needle.length)
      }
    }
  }
  return []
}

function findSectionHeading(root: HTMLElement, section: string): HTMLElement | null {
  const wanted = normalize(section)
  const headings = root.querySelectorAll<HTMLElement>('h2, h3, h4, h5, h6')
  return [...headings].find((heading) => normalize(heading.textContent ?? '') === wanted) ?? null
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/** Scroll, then again a frame later once layout (highlight, lead image) has settled. */
async function scrollToTarget(target: HTMLElement, block: ScrollLogicalPosition): Promise<void> {
  await nextFrame()
  target.scrollIntoView({ block })
  await nextFrame()
  target.scrollIntoView({ block })
}

/**
 * Resolves once the article is scrolled into place (so the caller can reveal it), with
 * what it landed on: the highlighted answer, the section heading, or nothing.
 */
export async function landOnPassage(
  root: HTMLElement,
  target: { answer?: string; section?: string },
): Promise<'answer' | 'section' | null> {
  const marks = target.answer ? findAnswer(root, target.answer) : []
  if (marks.length) {
    injectAnswerStyle(root.ownerDocument)
    await scrollToTarget(marks[0], 'center')
    return 'answer'
  }

  const heading = target.section ? findSectionHeading(root, target.section) : null
  if (heading) {
    await scrollToTarget(heading, 'start')
    return 'section'
  }

  return null
}
