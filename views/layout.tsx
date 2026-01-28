export function Layout(props: {
  readonly title: string;
  readonly children: any;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{props.title}</title>
        <script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.8/dist/htmx.min.js"></script>
        <style>{`
          body { font-family: system-ui, sans-serif; max-width: 820px; margin: 32px auto; padding: 0 16px; }
          header { display:flex; align-items: baseline; justify-content: space-between; gap: 16px; }
          .card { border: 1px solid #ddd; border-radius: 12px; padding: 16px; margin: 16px 0; }
          .row { display:flex; gap: 8px; align-items: center; }
          input[type="text"] { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid #ccc; }
          button { padding: 10px 12px; border-radius: 10px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
          button:hover { background: #f7f7f7; }
          .todo { display:flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #eee; }
          .todo:last-child { border-bottom: 0; }
          .muted { color: #666; font-size: 13px; }
          .done { text-decoration: line-through; color: #888; }
          code { background:#f6f6f6; padding:2px 6px; border-radius: 6px; }
        `}</style>
      </head>
      <body>{props.children}</body>
    </html>
  );
}
