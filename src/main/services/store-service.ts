class StoreService {
  store: any;
  constructor(store: any) {
    this.store = store;
  }

  setStore(key: any, val: any) {
    this.store.set(key, val);
  }

  getStore(key: any) {
    return this.store.get(key);
  }
}

export default StoreService;
