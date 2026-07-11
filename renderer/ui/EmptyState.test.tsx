// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'

afterEach(() => cleanup())

describe('EmptyState', () => {
  it('renders heading only when icon/body/hint omitted', () => {
    const { container } = render(<EmptyState heading="No dictations yet" />)
    expect(screen.getByText('No dictations yet')).toBeInTheDocument()
    expect(container.querySelector('.glass-card')).not.toBeInTheDocument()
  })

  it('renders icon, body and hint when provided', () => {
    render(
      <EmptyState
        icon={<span data-testid="icon">i</span>}
        heading="No dictations yet"
        body="Your past dictations will show up here."
        hint="Press fn anywhere"
      />
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('Your past dictations will show up here.')).toBeInTheDocument()
    expect(screen.getByText('Press fn anywhere')).toBeInTheDocument()
  })
})
