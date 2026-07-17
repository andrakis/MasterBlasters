// The local player: pointer-lock input -> UserCmds, the prediction shim (the SAME
// integrateBody the worker runs, reconciled toward each authoritative frame), and
// both cameras. Camera rotation is render-only; the yaw/pitch carried on the cmd
// is aim — an input, never the camera.

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TUNING as T, WEAPONS } from '../config.ts';
import { BTN, type UserCmd } from '../protocol.ts';
import { integrateBody, type BodyState, type MoveInput } from '../sim/movement.ts';
import { rayVsBoxes } from '../sim/collision.ts';
import type { Box, MapDef } from '../sim/maps/types.ts';
import { getAuthoritativeLocal, getNetRole, prunePendingCmds, sendCmd } from '../simClient.ts';
import { useStore } from '../store.ts';
import { stepShake } from './shake.ts';
import { Viewmodel } from './Viewmodel.tsx';

const LOOK_SPEED = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
// Predicted position pulls toward the worker's authoritative one at this rate.
// High enough that knockback (worker-only) lands within ~a tenth of a second.
const RECONCILE_RATE = 12;
const SNAP_DIST = 4; // respawns and teleport-sized errors snap instead of glide

const TP_OFFSET = new THREE.Vector3(0.65, 0.55, 3.4);
const BASE_FOV = 75;
const TICK_DT = 1 / 60;

interface Keys { f: boolean; b: boolean; l: boolean; r: boolean; space: boolean }

export function PlayerRig({ map, boxes }: { map: MapDef; boxes: Box[] }) {
  const { camera, gl } = useThree();
  const body = useRef<BodyState>({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    grounded: true, jetting: false, energy: T.JET_ENERGY_MAX, kbLockT: 0,
  });
  const yaw = useRef(0);
  const pitch = useRef(0);
  const locked = useRef(false);
  const keys = useRef<Keys>({ f: false, b: false, l: false, r: false, space: false });
  const prevSpace = useRef(false);
  const lmb = useRef(false);
  const pendingWeapon = useRef(-1);
  const seq = useRef(0);
  const wasAlive = useRef(true);
  const scratchDir = useRef(new THREE.Vector3());
  const scratchOff = useRef(new THREE.Vector3());
  // client-mode prediction: last snapshot tick we rebased from, plus a visual
  // smoothing offset that soaks up rebase pops (decays over ~80 ms)
  const lastAuthTick = useRef(-1);
  const smooth = useRef({ x: 0, y: 0, z: 0 });
  const replayInput = useRef<MoveInput>({ moveX: 0, moveZ: 0, jumpEdge: false, jetHeld: false });

  useEffect(() => {
    const canvas = gl.domElement;
    const requestLock = () => {
      if (useStore.getState().appPhase === 'playing') canvas.requestPointerLock();
    };
    const onLockChange = () => {
      locked.current = document.pointerLockElement === canvas;
      useStore.getState().setPointerLocked(locked.current);
      if (!locked.current) {
        keys.current = { f: false, b: false, l: false, r: false, space: false };
        lmb.current = false;
        seq.current = (seq.current + 1) & 0xffff;
        sendCmd({ seq: seq.current, buttons: 0, moveX: 0, moveZ: 0, yaw: yaw.current, pitch: pitch.current, weapon: -1 });
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!locked.current) return;
      yaw.current -= e.movementX * LOOK_SPEED;
      pitch.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch.current - e.movementY * LOOK_SPEED));
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!locked.current) return;
      if (e.button === 0) lmb.current = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) lmb.current = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (!locked.current) return;
      const hud = useStore.getState().hud;
      if (!hud) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      let w = hud.weapon;
      for (let i = 0; i < WEAPONS.length; i++) {
        w = (w + dir + WEAPONS.length) % WEAPONS.length;
        if (hud.ammo[w] !== 0) break;
      }
      pendingWeapon.current = w;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!locked.current) return;
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': keys.current.f = true; break;
        case 'KeyS': case 'ArrowDown': keys.current.b = true; break;
        case 'KeyA': case 'ArrowLeft': keys.current.l = true; break;
        case 'KeyD': case 'ArrowRight': keys.current.r = true; break;
        case 'Space': e.preventDefault(); keys.current.space = true; break;
        case 'KeyC': {
          const s = useStore.getState();
          s.setCamMode(s.camMode === 'fp' ? 'tp' : 'fp');
          break;
        }
        case 'Digit1': pendingWeapon.current = 0; break;
        case 'Digit2': pendingWeapon.current = 1; break;
        case 'Digit3': pendingWeapon.current = 2; break;
        case 'Digit4': pendingWeapon.current = 3; break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': keys.current.f = false; break;
        case 'KeyS': case 'ArrowDown': keys.current.b = false; break;
        case 'KeyA': case 'ArrowLeft': keys.current.l = false; break;
        case 'KeyD': case 'ArrowRight': keys.current.r = false; break;
        case 'Space': keys.current.space = false; break;
      }
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener('click', requestLock);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      canvas.removeEventListener('click', requestLock);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    const store = useStore.getState();

    // wish direction in world space (three convention: yaw 0 faces -Z)
    const k = keys.current;
    let ix = 0;
    let iz = 0;
    if (k.f) iz -= 1;
    if (k.b) iz += 1;
    if (k.l) ix -= 1;
    if (k.r) ix += 1;
    let moveX = 0;
    let moveZ = 0;
    if (ix !== 0 || iz !== 0) {
      const len = Math.hypot(ix, iz);
      ix /= len;
      iz /= len;
      const sin = Math.sin(yaw.current);
      const cos = Math.cos(yaw.current);
      moveX = ix * cos + iz * sin;
      moveZ = iz * cos - ix * sin;
    }

    // Space is jump AND jet: the edge jumps off the ground, the hold thrusts.
    let buttons = 0;
    if (k.space) buttons |= BTN.JUMP | BTN.JET;
    if (lmb.current) buttons |= BTN.FIRE;

    if (locked.current && store.matchLive) {
      seq.current = (seq.current + 1) & 0xffff; // u16 on the wire
      if (seq.current === 0) seq.current = 1;
      const cmd: UserCmd = {
        seq: seq.current,
        buttons,
        moveX,
        moveZ,
        yaw: yaw.current,
        pitch: pitch.current,
        weapon: pendingWeapon.current,
      };
      sendCmd(cmd);
      pendingWeapon.current = -1;
    }

    // --- prediction + reconciliation -------------------------------------------
    const auth = getAuthoritativeLocal();
    const alive = auth?.alive ?? true;
    const role = getNetRole();
    if (auth && alive) {
      const b = body.current;
      if (!wasAlive.current) {
        // respawn: teleport, don't glide across the map
        b.x = auth.x; b.y = auth.y; b.z = auth.z;
        b.vx = auth.vx; b.vy = auth.vy; b.vz = auth.vz;
        smooth.current.x = 0; smooth.current.y = 0; smooth.current.z = 0;
      }

      if (role === 'client' && auth.tick !== lastAuthTick.current) {
        // HL2-style prediction: rebase on the fresh snapshot, then replay every
        // cmd the host hasn't folded in yet through the SAME integrator
        lastAuthTick.current = auth.tick;
        const beforeX = b.x;
        const beforeY = b.y;
        const beforeZ = b.z;
        b.x = auth.x; b.y = auth.y; b.z = auth.z;
        b.vx = auth.vx; b.vy = auth.vy; b.vz = auth.vz;
        b.grounded = auth.grounded;
        b.jetting = auth.jetting;
        b.energy = auth.energy;
        b.kbLockT = 0;
        const pending = prunePendingCmds(auth.cmdSeq);
        let prevBtns = 0;
        for (const c of pending) {
          const ri = replayInput.current;
          ri.moveX = c.moveX;
          ri.moveZ = c.moveZ;
          ri.jumpEdge = (c.buttons & BTN.JUMP) !== 0 && (prevBtns & BTN.JUMP) === 0;
          ri.jetHeld = (c.buttons & BTN.JET) !== 0;
          integrateBody(b, ri, TICK_DT, boxes, map.gravityMult ?? 1);
          prevBtns = c.buttons;
        }
        // soak the rebase pop into a decaying render-only offset
        const ex = beforeX - b.x;
        const ey = beforeY - b.y;
        const ez = beforeZ - b.z;
        if (Math.hypot(ex, ey, ez) < SNAP_DIST) {
          smooth.current.x += ex;
          smooth.current.y += ey;
          smooth.current.z += ez;
        }
      }

      const jumpEdge = k.space && !prevSpace.current;
      integrateBody(
        b,
        { moveX, moveZ, jumpEdge, jetHeld: k.space },
        dt,
        boxes,
        map.gravityMult ?? 1,
      );

      if (role !== 'client') {
        // local/host: the worker answers within a frame — lerp toward it
        const err = Math.hypot(auth.x - b.x, auth.y - b.y, auth.z - b.z);
        if (err > SNAP_DIST) {
          b.x = auth.x; b.y = auth.y; b.z = auth.z;
          b.vx = auth.vx; b.vy = auth.vy; b.vz = auth.vz;
        } else {
          const t = Math.min(1, RECONCILE_RATE * dt);
          b.x += (auth.x - b.x) * t;
          b.y += (auth.y - b.y) * t;
          b.z += (auth.z - b.z) * t;
          b.vx += (auth.vx - b.vx) * t;
          b.vy += (auth.vy - b.vy) * t;
          b.vz += (auth.vz - b.vz) * t;
        }
        b.energy = auth.energy; // sim-owned meter; prediction only moves the body
      }
    }
    wasAlive.current = alive;
    prevSpace.current = k.space;
    // decay the client smoothing offset
    const sm = smooth.current;
    const decay = Math.exp(-12 * dt);
    sm.x *= decay;
    sm.y *= decay;
    sm.z *= decay;

    // --- camera -------------------------------------------------------------------
    const shake = stepShake(dt);
    const now = performance.now();
    const sinceHurt = now - store.lastHurtAt;
    const punch = sinceHurt < 600 ? Math.exp(-sinceHurt / 180) : 0;

    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch.current, yaw.current, 0);

    const b = body.current;
    const eyeX = b.x + sm.x;
    const eyeY = b.y + sm.y + T.EYE_HEIGHT;
    const eyeZ = b.z + sm.z;
    if (store.camMode === 'fp') {
      camera.position.set(eyeX, eyeY, eyeZ);
    } else {
      // over-shoulder: offset in view space, pulled in when a platform occludes
      const off = scratchOff.current.copy(TP_OFFSET).applyQuaternion(camera.quaternion);
      const dist = off.length();
      const dir = scratchDir.current.copy(off).normalize();
      const tHit = rayVsBoxes(eyeX, eyeY, eyeZ, dir.x, dir.y, dir.z, dist + 0.3, boxes);
      const pull = Math.min(dist, (tHit === Infinity ? dist + 0.3 : tHit) - 0.25);
      camera.position.set(eyeX + dir.x * pull, eyeY + dir.y * pull, eyeZ + dir.z * pull);
    }
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.3;
      camera.position.y += (Math.random() - 0.5) * shake * 0.3;
      camera.position.z += (Math.random() - 0.5) * shake * 0.3;
    }

    const cam = camera as THREE.PerspectiveCamera;
    const fov = BASE_FOV + punch * 8 + shake * 3;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // test-bridge camera probe (headless harness reads this; harmless in play)
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mbCam = {
        x: camera.position.x, y: camera.position.y, z: camera.position.z,
        yaw: yaw.current, pitch: pitch.current,
        bx: b.x, by: b.y, bz: b.z, mode: store.camMode,
      };
    }
  });

  return <Viewmodel />;
}
