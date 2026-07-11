// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as barrel from './index'

describe('renderer/ui barrel', () => {
  it('re-exports every component, glyph and data helper', () => {
    expect(barrel.Toggle).toBeTypeOf('function')
    expect(barrel.Segmented).toBeTypeOf('function')
    expect(barrel.KeyCard).toBeTypeOf('function')
    expect(barrel.PageHeader).toBeTypeOf('function')
    expect(barrel.EmptyState).toBeTypeOf('function')
    expect(barrel.LoadingDots).toBeTypeOf('function')
    expect(barrel.ProviderGlyph).toBeTypeOf('function')
    expect(barrel.Kbd).toBeTypeOf('function')
    expect(barrel.TrashGlyph).toBeTypeOf('function')
    expect(barrel.CopyGlyph).toBeTypeOf('function')
    expect(barrel.CheckGlyph).toBeTypeOf('function')
    expect(barrel.MicGlyph).toBeTypeOf('function')
    expect(barrel.LANGUAGES.length).toBeGreaterThan(0)
    expect(barrel.IS_MAC).toBeTypeOf('boolean')
    expect(barrel.IS_WIN).toBeTypeOf('boolean')
    expect(barrel.IS_LINUX).toBeTypeOf('boolean')
    expect(barrel.dictationBindingLabel).toBeTypeOf('function')
    expect(barrel.instructionKeyLabel).toBeTypeOf('function')
    expect(barrel.modifierLabel).toBeTypeOf('function')
  })
})
