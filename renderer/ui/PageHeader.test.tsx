// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PageHeader } from './PageHeader'

afterEach(() => cleanup())

describe('PageHeader', () => {
  it('renders title only', () => {
    render(<PageHeader title="History" />)
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders subtitle when given', () => {
    render(<PageHeader title="History" subtitle="Local session history" />)
    expect(screen.getByText('Local session history')).toBeInTheDocument()
  })

  it('renders actions when given', () => {
    render(<PageHeader title="History" actions={<button type="button">Clear all</button>} />)
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument()
  })
})
