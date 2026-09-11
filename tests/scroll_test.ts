import { ScrollMomentum } from "../src/scroll.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
function flick(distance = 100) {
  const scroll = new ScrollMomentum();
  scroll.begin(0);
  scroll.move(distance, 20);
  scroll.move(distance, 40);
  scroll.release(45);
  return scroll;
}

Deno.test("fast swipes travel farther and decay to a stop", () => {
  const fast = flick(), slow = flick(10);
  let fastDistance = 0, slowDistance = 0, previous = Infinity;
  for (let i = 0; i < 400; i++) {
    const distance = fast.step(16);
    assert(distance <= previous, "momentum should slow down");
    previous = distance;
    fastDistance += distance;
    slowDistance += slow.step(16);
  }
  assert(fastDistance > 1500, "a fast swipe should cover a long collection");
  assert(fastDistance > slowDistance * 8, "swipe speed should affect travel");
  assert(!fast.moving && !slow.moving, "momentum must stop");
});

Deno.test("scroll distance is consistent at 60 Hz and 120 Hz", () => {
  const a = flick(), b = flick();
  let x = 0, y = 0;
  for (let i = 0; i < 60; i++) x += a.step(1000 / 60);
  for (let i = 0; i < 120; i++) y += b.step(1000 / 120);
  assert(Math.abs(x - y) < .01, "frame rate must not change momentum");
});

Deno.test("touching, holding still, or cancelling stops momentum", () => {
  const scroll = flick();
  scroll.begin(80);
  assert(scroll.step(16) === 0, "new touch brakes immediately");
  scroll.move(50, 100);
  assert(scroll.step(16) === 0, "no inertia while finger is down");
  scroll.release(250);
  assert(scroll.step(16) === 0, "holding still before release must not fling");
  const cancelled = flick();
  cancelled.stop();
  assert(cancelled.step(16) === 0, "cancelled gestures must not fling");
});

Deno.test("reverse swipes move upward and long frame gaps cannot jump the page", () => {
  const scroll = flick(-100);
  assert(scroll.step(16) < 0, "reverse swipe should travel upward");
  assert(Math.abs(scroll.step(10000)) < 400, "long frame gaps should be capped");
});
