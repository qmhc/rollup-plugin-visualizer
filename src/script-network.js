import { render } from "preact";
import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import { html } from "htm/preact";
import { max as d3max, extent as d3extent } from "d3-array";
import { scaleSqrt } from "d3-scale";

import { format as formatBytes } from "bytes";

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX
} from "d3-force";

import {
  COLOR_DEFAULT_OWN_SOURCE,
  COLOR_DEFAULT_VENDOR_SOURCE,
  COLOR_BASE
} from "./color";

import "./style/style-network.scss";

const NODE_MODULES = /.*(?:\/|\\\\)?node_modules(?:\/|\\\\)([^/\\]+)(?:\/|\\\\).+/;

const color = ({ renderedLength, id }) =>
  renderedLength === 0
    ? COLOR_BASE
    : id.match(NODE_MODULES)
    ? COLOR_DEFAULT_VENDOR_SOURCE
    : COLOR_DEFAULT_OWN_SOURCE;

const Tooltip = ({ node, visible, importedByCache }) => {
  const ref = useRef();
  const [style, setStyle] = useState({});
  const content = useMemo(() => {
    if (!node) return null;

    const size = node.renderedLength;

    const uid = node.uid;

    return html`
      <div>${node.id}</div>
      ${size !== 0 &&
        html`
          <div><b>Size: ${formatBytes(size)}</b></div>
        `}
      ${uid &&
        importedByCache.has(uid) &&
        html`
          <div>
            <div><b>Imported By</b>:</div>
            ${[...new Set(importedByCache.get(uid).map(({ id }) => id))].map(
              id =>
                html`
                  <div>${id}</div>
                `
            )}
          </div>
        `}
    `;
  }, [node]);

  const updatePosition = mouseCoords => {
    const pos = {
      left: mouseCoords.x + Tooltip.marginX,
      top: mouseCoords.y + Tooltip.marginY
    };

    const boundingRect = ref.current.getBoundingClientRect();

    if (pos.left + boundingRect.width > window.innerWidth) {
      // Shifting horizontally
      pos.left = window.innerWidth - boundingRect.width;
    }

    if (pos.top + boundingRect.height > window.innerHeight) {
      // Flipping vertically
      pos.top = mouseCoords.y - Tooltip.marginY - boundingRect.height;
    }

    setStyle(pos);
  };

  const handleMouseMove = event => {
    updatePosition({
      x: event.pageX,
      y: event.pageY
    });
  };

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove, true);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove, true);
    };
  }, []);

  return html`
    <div
      class="tooltip ${visible ? "" : "tooltip-hidden"}"
      ref=${ref}
      style=${style}
    >
      ${content}
    </div>
  `;
};

Tooltip.marginX = 10;
Tooltip.marginY = 30;

const Network = ({ width, height, links, nodes, size, onNodeHover }) => {
  return html`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox=${`0 0 ${width} ${height}`}>
      <g stroke="#999" stroke-opacity="0.6">
        ${links.map(link => {
          return html`
            <line
              stroke-width="1"
              x1=${link.source.x}
              y1=${link.source.y}
              x2=${link.target.x}
              y2=${link.target.y}
            />
          `;
        })}
      </g>
      <g stroke="#fff" stroke-width="1.5">
        ${nodes.map(node => {
          return html`
            <circle
              r=${size(node.renderedLength)}
              fill=${color(node)}
              cx=${node.x}
              cy=${node.y}
              onMouseOver=${evt => {
                evt.stopPropagation();
                onNodeHover(node);
              }}
            />
          `;
        })}
      </g>
    </svg>
  `;
};

const Chart = ({
  width,
  height,
  nodes,
  links,
  size,
  importedCache,
  importedByCache
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipNode, setTooltipNode] = useState(null);

  const handleMouseOut = () => {
    setShowTooltip(false);
  };

  useEffect(() => {
    document.addEventListener("mouseover", handleMouseOut);
    return () => {
      document.removeEventListener("mouseover", handleMouseOut);
    };
  }, []);

  return html`
    <${Network}
      width=${width}
      height=${height}
      links=${links}
      nodes=${nodes}
      size=${size}
      onNodeHover=${node => {
        setTooltipNode(node);
        setShowTooltip(true);
      }}
    />
    <${Tooltip}
      visible=${showTooltip}
      node=${tooltipNode}
      importedByCache=${importedByCache}
      importedCache=${importedCache}
    />
  `;
};

const drawChart = (
  parentNode,
  { nodes: origNodes, links: origLinks },
  width,
  height
) => {
  const nodes = Object.entries(origNodes).map(([uid, node]) => ({
    uid,
    ...node
  }));
  const nodesCache = new Map(nodes.map(d => [d.uid, d]));
  const links = origLinks.map(({ source, target }) => ({
    source: nodesCache.get(source),
    target: nodesCache.get(target),
    value: 1
  }));

  const maxLines = d3max(nodes, d => d.renderedLength);
  const size = scaleSqrt()
    .domain([1, maxLines])
    .range([5, 30]);

  const simulation = forceSimulation()
    .force(
      "link",
      forceLink()
        .id(d => d.id)
        .strength(1)
        .distance(50)
        .iterations(10)
    )
    .force(
      "collide",
      forceCollide().radius(d => size(d.renderedLength) + 1)
    )
    .force("forceX", forceX(height / 2).strength(0.05))
    .force("charge", forceManyBody().strength(-100))
    .force("center", forceCenter(width / 2, height / 2));

  simulation.nodes(nodes);
  simulation.force("link").links(links);
  simulation.stop();

  for (let i = 0; i < 300; i++) simulation.tick();

  let xExtent = d3extent(nodes, d => d.x);
  let yExtent = d3extent(nodes, d => d.y);

  const xRange = xExtent[1] - xExtent[0];
  const yRange = yExtent[1] - yExtent[0];

  //rotate
  if (yRange > xRange) {
    nodes.forEach(d => {
      const y = parseFloat(d.y);
      d.y = parseFloat(d.x);
      d.x = y;
    });

    const t = yExtent;
    yExtent = xExtent;
    xExtent = t;
  }

  //center
  const xCenter = (xExtent[1] - xExtent[0]) / 2 + xExtent[0];
  const yCenter = (yExtent[1] - yExtent[0]) / 2 + yExtent[0];

  const svgXCenter = width / 2;
  const svgYCenter = height / 2;

  const xCenterDiff = svgXCenter - xCenter;
  const yCenterDiff = svgYCenter - yCenter;

  nodes.forEach(d => {
    d.y += yCenterDiff;
    d.x += xCenterDiff;
  });

  const importedByCache = new Map();
  const importedCache = new Map();

  for (const { source, target } of origLinks || []) {
    if (!importedByCache.has(target)) {
      importedByCache.set(target, []);
    }
    if (!importedCache.has(source)) {
      importedCache.set(source, []);
    }

    importedByCache.get(target).push({ uid: source, ...origNodes[source] });
    importedCache.get(source).push({ uid: target, ...origNodes[target] });
  }

  console.log(importedByCache);

  render(
    html`
      <${Chart}
        width=${width}
        height=${height}
        nodes=${nodes}
        links=${links}
        size=${size}
        importedByCache=${importedByCache}
        importedCache=${importedCache}
      />
    `,
    parentNode
  );
};

export default drawChart;
