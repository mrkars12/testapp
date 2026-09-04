import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PhoneInput, { type PhoneValue } from './PhoneInput'

afterEach(cleanup)

/**
 * Root cause this component fixes: a genuinely valid Egyptian number
 * ("01157157215") was previously shown as invalid, and the country badge
 * rendered the literal fallback text "+--", because the phone field
 * borrowed "which country" from a separate, untouched field elsewhere on
 * the form instead of owning an explicit default itself
 * (isValidPhoneNumber('01157157215', undefined) === false, while
 * isValidPhoneNumber('01157157215', 'EG') === true). This component is now
 * a single, self-contained control with its own default country.
 */
describe('PhoneInput', () => {
  it('defaults to Egypt — no "+--" fallback state', () => {
    render(<PhoneInput defaultCountryCode="EG" onChange={vi.fn()} />)
    expect(screen.getByText('+20')).toBeInTheDocument()
    expect(screen.queryByText('+--')).not.toBeInTheDocument()
  })

  it('accepts a real Egyptian number that was previously rejected, and emits its E.164 form', async () => {
    const onChange = vi.fn<(v: PhoneValue | null) => void>()
    const user = userEvent.setup()
    render(<PhoneInput defaultCountryCode="EG" onChange={onChange} />)

    await user.type(screen.getByLabelText('رقم الهاتف'), '01157157215')

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ e164: '+201157157215', countryCode: 'EG', dialCode: '+20' }),
    )
    expect(screen.queryByText('رقم الهاتف غير صالح')).not.toBeInTheDocument()
  })

  it('rejects an impossible Egyptian number and shows a concise Arabic error, not a library error', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<PhoneInput defaultCountryCode="EG" onChange={onChange} />)

    const input = screen.getByLabelText('رقم الهاتف')
    await user.type(input, '123')
    await user.tab() // blur

    expect(screen.getByText('رقم الهاتف غير صالح')).toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('accepts a valid international (US) number when the user switches country', async () => {
    const onChange = vi.fn<(v: PhoneValue | null) => void>()
    const user = userEvent.setup()
    render(<PhoneInput defaultCountryCode="EG" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /رمز الدولة/ }))
    const listbox = screen.getByRole('listbox')
    await user.type(within(listbox).getByPlaceholderText('ابحث عن دولة...'), 'United States')
    await user.click(within(listbox).getByText('الولايات المتحدة'))

    await user.type(screen.getByLabelText('رقم الهاتف'), '2025551234')

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ e164: '+12025551234', countryCode: 'US' }),
    )
  })

  it('re-validates against the newly selected country instead of keeping the old verdict', async () => {
    const onChange = vi.fn<(v: PhoneValue | null) => void>()
    const user = userEvent.setup()
    render(<PhoneInput defaultCountryCode="EG" onChange={onChange} />)

    await user.type(screen.getByLabelText('رقم الهاتف'), '1157157215')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ countryCode: 'EG' }))

    onChange.mockClear()
    await user.click(screen.getByRole('button', { name: /رمز الدولة/ }))
    const listbox = screen.getByRole('listbox')
    await user.type(within(listbox).getByPlaceholderText('ابحث عن دولة...'), 'Saudi Arabia')
    await user.click(within(listbox).getByText('المملكة العربية السعودية'))

    // Same digits are not a valid Saudi number.
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('does not accept an arbitrary digit string just because it contains digits', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<PhoneInput defaultCountryCode="EG" onChange={onChange} />)

    await user.type(screen.getByLabelText('رقم الهاتف'), '00000000000000000000')

    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('has an accessible error association (aria-invalid + aria-describedby)', async () => {
    const user = userEvent.setup()
    render(<PhoneInput defaultCountryCode="EG" onChange={vi.fn()} />)

    const input = screen.getByLabelText('رقم الهاتف')
    await user.type(input, '123')
    await user.tab()

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', expect.stringContaining('error'))
  })

  it('does not show an invalid state on an untouched, empty field', () => {
    render(<PhoneInput defaultCountryCode="EG" onChange={vi.fn()} />)
    expect(screen.queryByText('رقم الهاتف غير صالح')).not.toBeInTheDocument()
    expect(screen.getByLabelText('رقم الهاتف')).toHaveAttribute('aria-invalid', 'false')
  })
})
