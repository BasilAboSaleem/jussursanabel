function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildExcel(sheetName, headers, rows, colWidths = []) {
  const headerRow = headers
    .map((h) => `<Cell ss:StyleID="header"><Data ss:Type="String">${esc(h)}</Data></Cell>`)
    .join('');

  const columnDefs = (colWidths.length ? colWidths : headers.map(() => 160))
    .map((w) => `<Column ss:AutoFitWidth="0" ss:Width="${w}"/>`)
    .join('\n      ');

  const dataRows = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const isNum = typeof cell === 'number';
          return `<Cell ss:StyleID="${isNum ? 'num' : 'data'}"><Data ss:Type="${
            isNum ? 'Number' : 'String'
          }">${esc(cell)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="11"/>
      <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2"/></Borders>
    </Style>
    <Style ss:ID="data">
      <Alignment ss:Horizontal="Right" ss:Vertical="Center" ss:WrapText="1"/>
      <Font ss:Size="10"/>
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/></Borders>
    </Style>
    <Style ss:ID="num">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Font ss:Size="10" ss:Bold="1"/>
      <NumberFormat ss:Format="#,##0.00"/>
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/></Borders>
    </Style>
  </Styles>
  <Worksheet ss:Name="${esc(sheetName)}">
    <Table>
      ${columnDefs}
      <Row ss:AutoFitHeight="1">${headerRow}</Row>
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;
}

module.exports = { buildExcel };

