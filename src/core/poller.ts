/** Serial, self-scheduling work; stop invalidates an in-flight generation. */
export class Poller {
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private running = false;
  constructor(
    private task: () => Promise<number>,
    private onError: (error: unknown) => void = () => {},
  ) {}
  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    const generation = ++this.generation;
    const tick = async () => {
      let delay = 5000;
      try {
        delay = await this.task();
      } catch (e) {
        this.onError(e);
      }
      if (this.running && generation === this.generation) {
        this.timer = setTimeout(tick, Math.max(100, delay));
      }
    };
    void tick();
  }
  stop() {
    this.running = false;
    this.generation++;
    clearTimeout(this.timer);
  }
}
