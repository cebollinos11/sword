import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { deathTint, easeInOut, flightCamera, flightSeconds, flybyCamera, FLIGHT_SECONDS, TakeoverMark } from './takeoverView';

describe("The view of a Battle's takeover", () => {
  it('eases in and out, held at the ends', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(2)).toBe(1);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
  });

  it('flies by high over the field, watching the Soldier, and lands exactly behind its shoulder', () => {
    const from = new THREE.Vector3(0, 5, 0);
    const to = new THREE.Vector3(40, 2, 0);
    const focus = new THREE.Vector3(42, 1.2, 0);
    const fromQuat = new THREE.Quaternion();
    const toQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    const out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    flybyCamera(from, fromQuat, to, toQuat, focus, 0, out);
    expect(out.position.distanceTo(from)).toBeCloseTo(0);
    expect(out.quaternion.angleTo(fromQuat)).toBeCloseTo(0);
    // Halfway: well above the line between the two (0.35 m up a metre flown), looking at the Soldier.
    flybyCamera(from, fromQuat, to, toQuat, focus, 0.5, out);
    expect(out.position.x).toBeCloseTo(20);
    expect(out.position.y).toBeCloseTo(3.5 + from.distanceTo(to) * 0.35);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(out.quaternion);
    const toFocus = focus.clone().sub(out.position).normalize();
    expect(look.dot(toFocus)).toBeCloseTo(1, 5);
    flybyCamera(from, fromQuat, to, toQuat, focus, 1, out);
    expect(out.position.distanceTo(to)).toBeCloseTo(0);
    expect(out.quaternion.angleTo(toQuat)).toBeCloseTo(0);
  });

  it('flies longer the further it goes, within bounds', () => {
    expect(flightSeconds(0)).toBe(FLIGHT_SECONDS);
    expect(flightSeconds(30)).toBeGreaterThan(flightSeconds(5));
    expect(flightSeconds(1000)).toBe(1.4);
  });

  it('flies the camera along a rising arc, turning, and lands exactly behind the Soldier', () => {
    const from = new THREE.Vector3(0, 5, 0);
    const to = new THREE.Vector3(20, 2, 0);
    const fromQuat = new THREE.Quaternion();
    const toQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    expect(flightCamera(from, fromQuat, to, toQuat, 0, out)).toBe(false);
    expect(out.position.distanceTo(from)).toBeCloseTo(0);
    const seconds = flightSeconds(from.distanceTo(to));
    expect(flightCamera(from, fromQuat, to, toQuat, seconds / 2, out)).toBe(false);
    // Halfway along, and lifted above the straight line between the two.
    expect(out.position.x).toBeCloseTo(10);
    expect(out.position.y).toBeGreaterThan(3.5 + 1);
    expect(out.quaternion.angleTo(fromQuat)).toBeGreaterThan(0.1);
    expect(out.quaternion.angleTo(toQuat)).toBeGreaterThan(0.1);
    expect(flightCamera(from, fromQuat, to, toQuat, seconds, out)).toBe(true);
    expect(out.position.distanceTo(to)).toBeCloseTo(0);
    expect(out.quaternion.angleTo(toQuat)).toBeCloseTo(0);
  });

  it('greys and darkens the screen while the Player is down, and clears it after', () => {
    expect(deathTint(0)).toBe('');
    expect(deathTint(1)).toMatch(/^grayscale\(0\.8\d*\) brightness\(0\.65\d*\)$/);
    expect(deathTint(5)).toBe(deathTint(1));
  });

  it('marks the Soldier to be taken over in the Team colour, hidden otherwise', () => {
    const mark = new TakeoverMark();
    expect(mark.root.visible).toBe(false);
    mark.show({ x: 3, y: 1, z: -2 }, 0x2e86c1, 0.5, 0);
    expect(mark.root.visible).toBe(true);
    expect(mark.root.position.toArray()).toEqual([3, 1, -2]);
    mark.hide();
    expect(mark.root.visible).toBe(false);
    mark.dispose();
  });
});
