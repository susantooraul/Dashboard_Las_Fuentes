import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, AreaChart, Area } from 'recharts';

const colors = ['#e9082c', '#c40323', '#a0021c', '#8a3d26', '#f87171', '#fca5a5', '#fecaca', '#7f1d1d', '#dc2626'];
const axisColor = '#f8d7df';
const gridColor = 'rgba(255,255,255,.08)';
const tooltipStyle = { background: '#220910', border: '1px solid rgba(233,8,44,.18)', borderRadius: 12, color: '#fff' };

export function DemandChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#e9082c" stopOpacity={0.28} />
            <stop offset="95%" stopColor="#e9082c" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis dataKey="hour" stroke={axisColor} />
        <YAxis stroke={axisColor} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="total" stroke="#e9082c" fill="url(#fillTotal)" strokeWidth={3} />
        <Area type="monotone" dataKey="l1" stroke="#c40323" fill="transparent" strokeWidth={2} />
        <Area type="monotone" dataKey="l2" stroke="#8a3d26" fill="transparent" strokeWidth={2} />
        <Area type="monotone" dataKey="l3" stroke="#fca5a5" fill="transparent" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DistributionChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={104} paddingAngle={2}>
          {data.map((item, index) => <Cell key={item.name} fill={colors[index % colors.length]} />)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TransformerChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis dataKey="name" stroke={axisColor} />
        <YAxis stroke={axisColor} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="kwh" fill="#c40323" radius={[10, 10, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
