import D from 'better-sqlite3'
const db = new D('server/data.db', { readonly: true })
const show = (l, s) => console.log(l, JSON.stringify(db.prepare(s).get()))
export { show }
