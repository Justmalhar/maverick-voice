// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Segmented, type SegmentedOption } from './Segmented'

afterEach(() => cleanup())

const options: SegmentedOption<'a' | 'b' | 'c'>[] = [
  { value: 'a', label: 'A', icon: <span data-testid="icon-a">*</span> },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' }
]

describe('Segmented', () => {
  it('marks the active option checked and renders icon when given', () => {
    render(<Segmented options={options} value="b" onChange={() => {}} aria-label="Mode" />)
    const radios = screen.getAllByRole('radio')
    expect(radios[1]).toHaveAttribute('aria-checked', 'true')
    expect(radios[0]).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('icon-a')).toBeInTheDocument()
  })

  it('falls back to tabbableIndex 0 when value matches no option', () => {
    render(<Segmented options={options} value={'zzz' as 'a'} onChange={() => {}} aria-label="Mode" />)
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toHaveAttribute('tabindex', '0')
    expect(radios[1]).toHaveAttribute('tabindex', '-1')
  })

  it('calls onChange with the clicked option value', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Segmented options={options} value="a" onChange={onChange} aria-label="Mode" />)
    await user.click(screen.getByRole('radio', { name: 'C' }))
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('disables all options', () => {
    render(<Segmented options={options} value="a" onChange={() => {}} aria-label="Mode" disabled />)
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
  })

  it('navigates with ArrowRight/ArrowDown, wrapping at the end', () => {
    const onChange = vi.fn()
    render(<Segmented options={options} value="c" onChange={onChange} aria-label="Mode" />)
    const active = screen.getByRole('radio', { name: 'C' })
    active.focus()
    fireArrow(active, 'ArrowRight')
    expect(onChange).toHaveBeenCalledWith('a')
    onChange.mockClear()
    fireArrow(active, 'ArrowDown')
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('navigates with ArrowLeft/ArrowUp, wrapping at the start', () => {
    const onChange = vi.fn()
    render(<Segmented options={options} value="a" onChange={onChange} aria-label="Mode" />)
    const active = screen.getByRole('radio', { name: 'A' })
    fireArrow(active, 'ArrowLeft')
    expect(onChange).toHaveBeenCalledWith('c')
    onChange.mockClear()
    fireArrow(active, 'ArrowUp')
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('Home jumps to first, End jumps to last', () => {
    const onChange = vi.fn()
    render(<Segmented options={options} value="b" onChange={onChange} aria-label="Mode" />)
    const active = screen.getByRole('radio', { name: 'B' })
    fireArrow(active, 'Home')
    expect(onChange).toHaveBeenCalledWith('a')
    onChange.mockClear()
    fireArrow(active, 'End')
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('ignores unrelated keys without calling onChange', () => {
    const onChange = vi.fn()
    render(<Segmented options={options} value="b" onChange={onChange} aria-label="Mode" />)
    fireArrow(screen.getByRole('radio', { name: 'B' }), 'Tab')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('slides the active thumb to the selected index via translateX', () => {
    const { container, rerender } = render(
      <Segmented options={options} value="a" onChange={() => {}} aria-label="Mode" />
    )
    const thumb = container.querySelector('.ui-segment__thumb') as HTMLElement
    expect(thumb.style.transform).toBe('translateX(0%)')
    expect(thumb.style.opacity).toBe('1')

    rerender(<Segmented options={options} value="c" onChange={() => {}} aria-label="Mode" />)
    expect(thumb.style.transform).toBe('translateX(200%)')
  })

  it('hides the thumb when value matches no option', () => {
    const { container } = render(
      <Segmented options={options} value={'zzz' as 'a'} onChange={() => {}} aria-label="Mode" />
    )
    const thumb = container.querySelector('.ui-segment__thumb') as HTMLElement
    expect(thumb.style.opacity).toBe('0')
  })

  it('disables the thumb transition under prefers-reduced-motion', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true })
    vi.stubGlobal('matchMedia', matchMedia)
    const { container } = render(<Segmented options={options} value="a" onChange={() => {}} aria-label="Mode" />)
    const thumb = container.querySelector('.ui-segment__thumb') as HTMLElement
    expect(thumb.style.transition).toBe('none')
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    vi.unstubAllGlobals()
  })

  it('leaves the thumb transition to CSS when motion is not reduced', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    const { container } = render(<Segmented options={options} value="a" onChange={() => {}} aria-label="Mode" />)
    const thumb = container.querySelector('.ui-segment__thumb') as HTMLElement
    expect(thumb.style.transition).toBe('')
    vi.unstubAllGlobals()
  })
})

function fireArrow(el: Element, key: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}
