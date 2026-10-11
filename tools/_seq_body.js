  // Persistent arrival sequence per runway (AMAN): aircraft are inserted once,
  // by ETA, and keep their position. Emergencies go to the front (behind
  // aircraft already close in on final); aircraft re-joining after a
  // go-around are inserted with priority.
  sequenceArrivals(ap) {
    const cfg = this.w.config(ap);
    ap.seq = ap.seq || {};
    for (const rid of cfg.arr) {
      const r = ap.runways.get(rid);
      if (!r) continue;
      const live = (a) => a.arrRwy === r && a.dir === 'ARR' && !a.onGround && a.phase !== 'GOAROUND' && this.w.aircraft.includes(a);
      let list = (ap.seq[rid] || []).filter(live);
      const members = new Set(list);
      for (const a of list) a._eta = this.eta(a);
      const fresh = this.w.aircraft.filter((a) => live(a) && !members.has(a));
      for (const a of fresh) {
        a._eta = this.eta(a);
        let pos = list.length;
        if (a.emergency || a.priority) {
          // in front of everything not yet within ~8 NM of the threshold
          pos = list.findIndex((o) => !(o.appr?.established && o.appr.distThr < 8) && !o.emergency);
          if (pos < 0) pos = list.length;
        } else {
          // by ETA, but never ahead of aircraft already committed (holding / inside 35 NM)
          for (let i = list.length - 1; i >= 0; i--) {
            const o = list[i];
            if (o._eta <= a._eta || o.hold || o.distToGo() < 35 || o.appr?.established) { pos = i + 1; break; }
            pos = i;
          }
        }
        list.splice(pos, 0, a);
        a.priority = false;
      }
      // an emergency already in the list moves to the front
      const em = list.filter((a) => a.emergency && !a._emSeq);
      for (const a of em) {
        list = list.filter((x) => x !== a);
        let pos = list.findIndex((o) => !(o.appr?.established && o.appr.distThr < 8));
        if (pos < 0) pos = list.length;
        list.splice(pos, 0, a); a._emSeq = true;
      }
      ap.seq[rid] = list;

      let prev = null, prevSlot = -Infinity;
      const mixed = ((cfg.mixed || []).includes(rid) && ap.depQueue.some((d) => d.depRwy === r))
        || ap.depQueue.some((d) => (d.depRwy?.crossing || []).includes(rid));
      list.forEach((a, i) => {
        let slot = a._eta;
        if (prev) {
          const sepNm = Math.max(FINAL_MIN_NM, WAKE_NM[prev.wake]?.[a.wake] || 0) + 1.2 + (mixed ? 3.0 : 0);
          const gap = Math.max(sepNm / (a.perf.vapp + 5) * 3600, 85);
          slot = Math.max(slot, prevSlot + gap);
        }
        a.slot = slot; a.seq = i + 1; a.delay = slot - a._eta;
        this.w.stats.maxDelay = Math.max(this.w.stats.maxDelay, a.delay);
        this.absorbDelay(a, prev);
        prev = a; prevSlot = slot;
      });
    }
  }

