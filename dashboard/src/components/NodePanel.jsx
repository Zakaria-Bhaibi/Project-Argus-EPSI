// Live readings of one node: three small single-series charts (one measure each, one axis each).
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { NODE_INFO, nodeLabel } from '../site.js'
import { locale, t } from '../i18n.js'

const INK = '#34495A', MUTED = '#7D8B95', RULE = '#C9D2D8'
const time = (ts) => new Date(ts * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function Spark({ title, unit, data, field, domain, alarm, format = (v) => v.toFixed(1) }) {
  const last = data.length ? data[data.length - 1][field] : null
  return (
    <figure className="spark">
      <figcaption>
        <span className="spark-title">{title}</span>
        <span className="spark-value">{last == null ? '—' : format(last)}<small>{unit}</small></span>
      </figcaption>
      <div className="spark-plot">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="ts" hide />
            <YAxis domain={domain} width={34} tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} tickCount={3}
                   allowDecimals={false} tickFormatter={(v) => (Math.abs(v) < 2 ? v.toFixed(1) : Math.round(v))} />
            {alarm != null && (
              <ReferenceLine y={alarm} stroke="#C2185B" strokeDasharray="4 3"
                             label={{ value: t('spark.alarm'), position: 'insideTopRight', fill: '#7D8B95', fontSize: 11 }} />
            )}
            <Tooltip
              cursor={{ stroke: RULE }}
              contentStyle={{ border: `1px solid ${RULE}`, borderRadius: 4, fontSize: 12 }}
              labelFormatter={time}
              formatter={(v) => [v == null ? '—' : `${format(v)} ${unit}`, title]}
            />
            <Line type="monotone" dataKey={field} stroke={INK} strokeWidth={2} dot={false} isAnimationActive={false}
                  connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

export default function NodePanel({ id, node, series, traffic }) {
  if (!id) {
    return (
      <section className="panel node-panel is-empty">
        <p>{t('node.empty')}</p>
      </section>
    )
  }
  const data = series || []
  const statusText = t(`status.${node?.status ?? 'unknown'}`)
  return (
    <section className="panel node-panel" aria-label={t('node.readings', { node: nodeLabel(id) })}>
      <header className="panel-head">
        <h2>{nodeLabel(id)}</h2>
        <p className="node-sub">
          <span className={`status status-${node?.status ?? 'unknown'}`}>{statusText}</span>
          <span>{id}</span>
          <span>{NODE_INFO[id]?.simulated ? t('node.simulated') : t('node.firmware')}</span>
          {traffic && <span>{t('node.traffic', { msgs: traffic.msgs })}</span>}
          {node?.last?.pir && <span className="status status-pir">{t('node.motion')}</span>}
        </p>
      </header>
      <div className="sparks">
        <Spark title={t('spark.temp')} unit="°C" data={data} field="temp_c" domain={[(m) => Math.floor(m - 1), (m) => Math.ceil(m + 1)]} />
        <Spark title={t('spark.gas')} unit="ppm" data={data} field="gas_ppm" domain={[0, (m) => Math.ceil((m + 100) / 100) * 100]} format={(v) => Math.round(v).toString()} />
        <Spark title={t('spark.anomaly')} unit="" data={data} field="anomaly" domain={[0, 1]} alarm={0.5} format={(v) => v.toFixed(2)} />
      </div>
    </section>
  )
}
