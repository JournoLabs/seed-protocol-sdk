import React, { type FC } from 'react'
import type { PublishMode } from '../types'

export type PublishModeButtonsProps = {
  value: PublishMode
  onChange: (mode: PublishMode) => void
  disabled?: boolean
  /** Accessible label for the group */
  'aria-label'?: string
}

/**
 * Optional control to choose patch (same Version) vs new Version before calling
 * `ensureSmartWalletThenPublish(item, …, { publishMode })` or `PublishManager.createPublish(…, { publishMode })`.
 */
export const PublishModeButtons: FC<PublishModeButtonsProps> = ({
  value,
  onChange,
  disabled = false,
  'aria-label': ariaLabel = 'Publish mode',
}) => {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    gap: 8,
    flexWrap: 'wrap',
  }
  const btn = (active: boolean): React.CSSProperties => ({
    padding: '8px 14px',
    fontSize: 13,
    borderRadius: 8,
    border: `1px solid ${active ? '#344054' : '#D0D5DD'}`,
    background: active ? '#101828' : '#fff',
    color: active ? '#fff' : '#344054',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  })

  return (
    <div role="group" aria-label={ariaLabel} style={base}>
      <button
        type="button"
        disabled={disabled}
        style={btn(value === 'patch')}
        onClick={() => onChange('patch')}
      >
        Publish updates
      </button>
      <button
        type="button"
        disabled={disabled}
        style={btn(value === 'new_version')}
        onClick={() => onChange('new_version')}
      >
        New version
      </button>
    </div>
  )
}
