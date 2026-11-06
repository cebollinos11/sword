import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { deathTint, easeInOut, fallenDrift, flightCamera, flightSeconds, FLIGHT_SECONDS, TakeoverMark } from './takeoverView';

describe("The view of a Battle's takeover", () => {
  it('eases in and out, held at the ends', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(2)).toBe(1);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
  });

  it('holds the fallen camera still while the fall plays, then drifts it toward the Soldier and back', () => {
    expect(fallenDrift(0, 10)).toEqual({ aim: 0, pull: 1, look: 0 });
    expect(fallenDrift(0.2, 10)).toEqual({ aim: 0, pull: 1, look: 0 });
    const mid = fallenDrift(0.6, 10);
    const end = fallenDrift(1, 10);
    expect(mid.aim).toBeGreaterThan(0);
    expect(end.aim).toBeGreaterThan(mid.aim);
    expect(end.aim).toBeLessThan(1);
    expect(end.pull).toBeGreaterThan(1);
  });

  it('drifts only a few metres toward a Soldier far off, so the view is not left on empty field', () => {
    expect(fallenDrift(1, 100).aim * 100).toBeLessThanOrEqual(8);
    expect(fallenDrift(1, 0).aim).toBe(0);
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
