/** Finger velocity in pixels/ms; momentum is integrated independently of frame rate. */
export class ScrollMomentum {
  private velocity = 0;
  private dragging = false;
  private lastMove = 0;

  get moving() {
    return !this.dragging && Math.abs(this.velocity) >= .02;
  }

  begin(time: number) {
    this.stop();
    this.dragging = true;
    this.lastMove = time;
  }

  move(distance: number, time: number) {
    if (!this.dragging) return;
    const elapsed = Math.max(8, time - this.lastMove);
    const speed = Math.max(-8, Math.min(8, distance / elapsed));
    this.velocity = elapsed > 100 ? speed : this.velocity * .3 + speed * .7;
    this.lastMove = time;
  }

  release(time: number) {
    this.dragging = false;
    // Holding still before lifting should stop the page, rather than launch an old swipe.
    if (time - this.lastMove > 100 || Math.abs(this.velocity) < .08) this.stop();
  }

  step(elapsed: number) {
    if (!this.moving) return 0;
    const decay = Math.exp(-Math.min(50, Math.max(0, elapsed)) / 420);
    const distance = this.velocity * 420 * (1 - decay);
    this.velocity *= decay;
    if (!this.moving) this.stop();
    return distance;
  }

  stop() {
    this.velocity = 0;
    this.dragging = false;
  }
}
