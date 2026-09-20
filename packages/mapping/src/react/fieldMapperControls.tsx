import React from 'react'
import type {
  FieldMapperButtonProps,
  FieldMapperPillProps,
  FieldMapperSelectProps,
} from './fieldMapperSlots'

/** Default native select used when no `components.Select` is provided. */
export function DefaultSelect({
  className,
  value,
  onChange,
  children,
  disabled,
  'aria-label': ariaLabel,
}: FieldMapperSelectProps) {
  return (
    <select
      className={className}
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  )
}

/** Default native button used when no `components.Button` is provided. */
export function DefaultButton({
  className,
  type = 'button',
  onClick,
  children,
  disabled,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
}: FieldMapperButtonProps) {
  return (
    <button
      type={type}
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
    >
      {children}
    </button>
  )
}

/** Default span pill used when no `components.Pill` is provided. */
export function DefaultPill({
  className,
  children,
}: FieldMapperPillProps) {
  return <span className={className}>{children}</span>
}
