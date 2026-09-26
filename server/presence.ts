interface Watcher {
  gameId: string;
  playerId?: string;
}

export class Presence {
  private watchers = new Map<string, Watcher>();

  watch(socketId: string, gameId: string, playerId?: string): Watcher | undefined {
    const previous = this.watchers.get(socketId);
    this.watchers.set(socketId, { gameId, playerId });
    return previous;
  }

  leave(socketId: string): Watcher | undefined {
    const previous = this.watchers.get(socketId);
    this.watchers.delete(socketId);
    return previous;
  }

  connected(gameId: string, playerId: string): boolean {
    return [...this.watchers.values()].some((watcher) => watcher.gameId === gameId && watcher.playerId === playerId);
  }
}
