export type Fields = Record<string, unknown>;
export function defaults(schema: Fields): Fields {
  const result: Fields = {};
  for (const [key, property] of Object.entries((schema.properties ?? {}) as Fields)) { const p = property as Fields; if ('default' in p) result[key] = p.default; else if (Array.isArray(p.enum) && p.enum.length) result[key] = p.enum[0]; else if (p.type === 'object') result[key] = defaults(p); else if (p.type === 'boolean') result[key] = false; else if (p.type === 'array') result[key] = []; }
  return result;
}
export function SchemaFields({ schema, value, onChange }: { schema: Fields; value: Fields; onChange: (v: Fields) => void }) {
  const required = (schema.required ?? []) as string[];
  return <>{Object.entries((schema.properties ?? {}) as Fields).map(([name, raw]) => {
    const field = raw as Fields; const type = String(field.type); const options = field.enum as unknown[] | undefined;
    const change = (v: unknown) => onChange({ ...value, [name]: v });
    if(type==='object')return <fieldset key={name}><legend>{String(field.title??name)}</legend><SchemaFields schema={field} value={(value[name]??{}) as Fields} onChange={change}/></fieldset>;
    return <label key={name}>{String(field.title ?? name)}{required.includes(name) ? ' *' : ''}
      {type === 'array' ? <textarea aria-label={String(field.title ?? name)} value={JSON.stringify(value[name] ?? [])} onChange={e=>{try{const a=JSON.parse(e.target.value);if(Array.isArray(a)&&a.length<=Number(field.maxItems))change(a);}catch{/* keep last valid value */}}} /> : options ? <select value={JSON.stringify(value[name] ?? options[0])} onChange={e => change(JSON.parse(e.target.value))}>{options.map(v => <option key={JSON.stringify(v)} value={JSON.stringify(v)}>{String(v)}</option>)}</select> : type === 'boolean' ? <input type="checkbox" checked={Boolean(value[name])} onChange={e => change(e.target.checked)} /> : <input required={required.includes(name)} type={['integer', 'number'].includes(type) ? 'number' : 'text'} min={field.minimum as number | undefined} max={field.maximum as number | undefined} step={type === 'integer' ? 1 : 'any'} value={String(value[name] ?? '')} onChange={e => change(['integer', 'number'].includes(type) ? Number(e.target.value) : e.target.value)} />}
    </label>;
  })}</>;
}
