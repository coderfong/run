// Input — a TextInput that shows its focus.
//
// "FOCUS ALWAYS VISIBLE" is one of the reference system sheet's usage rules,
// printed on it twice, and it is the one the app had no answer to: a focused
// field looked exactly like an unfocused one, in both schemes, everywhere.
//
// This is deliberately NOT a full field component. It does not own the padding,
// the fill, the type or the error copy — those already live in each screen's
// `styles.input`, built on `nbField`, and there are a dozen of them with real
// differences (a six-digit code set at 30pt and letterspaced, a chat composer
// that grows to a maxHeight, a caption box with a counter under it). Replacing
// all of that with one component's props would be a much larger change than the
// problem needs, and would flatten differences that are there on purpose.
//
// So it adds exactly one thing to whatever style it is given: the ring. Swapping
// a `TextInput` for an `Input` is a one-word change at the call site and the
// field keeps every bit of its existing styling.
//
// THE RING REPLACES THE STROKE'S COLOUR AND NOT ITS WIDTH. A focus state that
// thickens the border re-lays-out the field under the cursor, which pushes the
// text sideways at the exact moment somebody is trying to type in it. Same
// width, different colour, nothing moves — the same trick `inputError` uses.

import React, { forwardRef, useState } from 'react';
import { TextInput } from 'react-native';

import { NB_FOCUS } from '../../theme';

/**
 * `focusColor`  the ring. Defaults to the system's yellow — see NB_FOCUS.
 * `focusable`   set false for a field that should not advertise focus (a
 *               read-only display that happens to be a TextInput).
 *
 * Everything else is forwarded to TextInput untouched, and the ref reaches it,
 * so `focus()`, `blur()` and `onSubmitEditing` chains keep working.
 */
const Input = forwardRef(function Input(
  { style, focusColor = NB_FOCUS, focusable = true, onFocus, onBlur, ...rest },
  ref
) {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      ref={ref}
      // Last, so it wins over the resting stroke AND over an error colour: a
      // field you are currently typing in should say so even when what it
      // previously said was that it was wrong.
      style={[style, focused && focusable && { borderColor: focusColor }]}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      {...rest}
    />
  );
});

export default Input;
