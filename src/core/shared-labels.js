/**
 * Labels that carry a shared value rather than an identity: a switch's phase
 * and a rail marker's local rail name. Several parts may hold the same one, so
 * one edit can set it on a whole selection. Part names, which must be unique,
 * never go through here.
 */

import { isReferenceMarker, referenceMarkerInfo } from './model.js';
import { switchState } from './beats.js';

/** What kind of shared value a part's label holds, or null for a name. */
export function sharedLabelKind(component) {
  if (!component) return null;
  if (switchState(component)) return 'switch';
  if (isReferenceMarker(component)) return component.type;
  return null;
}

/** The parts among `refs` whose label holds the same kind of value as
 *  `owner`'s: every switch for a switch, the same rail type for a marker. */
export function sharedLabelPeers(circuit, owner, refs = []) {
  const kind = sharedLabelKind(owner);
  if (!kind) return [];
  return refs
    .filter((refdes) => refdes !== owner.refdes)
    .map((refdes) => circuit.components.get(refdes))
    .filter((component) => sharedLabelKind(component) === kind);
}

/** Set the phase or local rail name of `refdes`; empty text clears it (a
 *  marker goes back to its global rail). */
export function setSharedLabel(circuit, refdes, text) {
  const component = circuit.getComponent(refdes);
  const kind = sharedLabelKind(component);
  if (!kind) throw new Error(`${refdes} has a name, not a shared label`);
  const value = String(text ?? '').trim();
  if (kind === 'switch') {
    circuit.setValue(refdes, value);
    return component;
  }
  let label = circuit.labelOf(refdes);
  if (!value) {
    if (label) {
      label.setText('');
      circuit.removeLabel(label.id);
    }
    return component;
  }
  label ||= circuit.addLabel({
    text: '',
    owner: refdes,
    offset: referenceMarkerInfo(component.type).labelOffset,
    align: 'parent',
    style: { color: component.style.color },
  });
  label.setText(value);
  return component;
}
