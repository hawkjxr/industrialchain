import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as echarts from 'echarts';
import { GitBranch, ArrowRight, DollarSign, TrendingUp, Eye, Crosshair, Zap, Network, TreePine, UserCircle2, Link2, MapPinned, Users2, Award, Code, Save, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useChartTheme } from '../hooks/useChartTheme';
import { useDataStore } from '../store/data';
import type { ChainNodeInfo, ChainTreeNode } from '../data/types';
import {
  enterpriseNodes,
  relationLinks,
  relationTypeConfig,
  type EnterpriseNode,
  type RelationLink,
  type RelationType,
} from '../data/relationLinkData';

const catColor: Record<string, string> = {
  '上游': '#3B82F6',
  '中游': '#00E676',
  '装备': '#FAAD14',
  '下游': '#A78BFA',
  '核心': '#00E676',
};

export const IndustryChain: React.FC = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const chainNodes = useDataStore(s => s.chainNodes);
  const chainNodeRelations = useDataStore(s => s.chainNodeRelations);
  const chainTreeData = useDataStore(s => s.chainTreeData);
  const chainFirms = useDataStore(s => s.chainFirms);
  const sideData = useDataStore(s => s.chainFinancingData);

  const nodeDetails = useMemo(() => {
    const details: Record<string, ChainNodeInfo> = {};
    chainNodes.forEach(node => {
      details[node.name] = {
        id: node.id,
        chainId: node.chainId,
        name: node.name,
        scale: node.scale,
        activity: node.activity,
        bankRatio: node.bankRatio,
        leaseRatio: node.leaseRatio,
        firms: chainFirms[node.chainId]?.filter(f => f.nodeId === node.id).map(f => ({
          firmId: f.firmId,
          role: f.role,
          asset: f.asset,
          manager: f.manager,
          name: f.firmId,
        })) || [],
      };
    });
    return details;
  }, [chainNodes, chainFirms]);

  const [currentChainId, setCurrentChainId] = useState('chain_humanoid');
  const chains = useDataStore(s => s.chains);

  const currentTreeData = useMemo(() => {
    return chainTreeData[currentChainId];
  }, [chainTreeData, currentChainId]);

  const [selected, setSelected] = useState<ChainNodeInfo | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'graph' | 'relation' | 'markdown'>('tree');
  const [showOpportunityPanel, setShowOpportunityPanel] = useState(true);
  const [activeRelTypes, setActiveRelTypes] = useState<Set<RelationType>>(new Set(['chain', 'park', 'city', 'executive', 'association']));
  const [selectedNode, setSelectedNode] = useState<EnterpriseNode | null>(null);
  const [selectedLink, setSelectedLink] = useState<RelationLink | null>(null);
  const [nodeCollapseMap, setNodeCollapseMap] = useState<Record<string, boolean>>({});
  const nodeCollapseMapRef = useRef<Record<string, boolean>>({});
  const [markdownSource, setMarkdownSource] = useState('');
  const markdownSourceRef = useRef('');
  const syncMarkdownFnRef = useRef<(treeData: ChainTreeNode | undefined, chainId: string) => void>(() => {});
  const treeInstanceRef = useRef<echarts.ECharts | null>(null);
  const tc = useChartTheme();

  // ── 同步 markdownSource（全部展开的思维导图，ref 避免闭包陈旧） ──
  syncMarkdownFnRef.current = (treeData: ChainTreeNode | undefined, chainId: string) => {
    if (!treeData) return;
    function nodeToLines(node: ChainTreeNode, prefix: string, isLast: boolean, isRoot: boolean): string[] {
      const children = node.children || [];
      const connector = isRoot ? '' : (isLast ? '└─ ' : '├─ ');
      const valueStr = node.value != null ? ` [${node.value}亿]` : '';
      const lines = [`${prefix}${connector}**${node.name}**${valueStr}`];
      const childPrefix = prefix + (isRoot ? '' : (isLast ? '   ' : '│  '));
      children.forEach((child, i) => {
        lines.push(...nodeToLines(child, childPrefix, i === children.length - 1, false));
      });
      return lines;
    }
    const chainInfo = useDataStore.getState().chains.find(c => c.id === chainId);
    const header = `# ${chainInfo?.name || '产业链'} 思维导图\n`;
    const body = nodeToLines(treeData, '', true, true).join('\n');
    const md = header + body;
    setMarkdownSource(md);
    markdownSourceRef.current = md;
  };

  // ── 解析 markdown 源码，反构更新 treeData（支持编辑后反构）──
  const parseMarkdownToTree = useCallback((md: string): ChainTreeNode | null => {
    const lines = md.split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;
    const header = lines[0].replace(/^#\s*/, '').replace(/\s*\*\*$/, '').trim();
    if (!header) return null;

    const root: ChainTreeNode = {
      nodeId: 'root',
      name: header.replace(/\*\*$/, '').replace(/\*\*\s*\[.*/, '').trim(),
      level: 0,
      children: [],
    };
    const stack: { node: ChainTreeNode; indent: number }[] = [{ node: root, indent: -1 }];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^(\s*)([├└─│\s]*)\s*\*\*(.+?)\*\*(.*)/);
      if (!m) continue;
      const indent = m[1].length + m[2].replace(/[├└─│\s]/g, '').length;
      const namePart = m[3].trim();
      const valuePart = m[4].trim();
      const name = namePart.replace(/\s*\[.*/, '').trim();
      const valueStr = valuePart.match(/\[([\d.]+)亿\]/)?.[1];
      const newNode: ChainTreeNode = {
        nodeId: `md_${i}_${Date.now()}`,
        name,
        value: valueStr ? parseFloat(valueStr) : undefined,
        level: indent,
        children: [],
      };
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      stack[stack.length - 1].node.children = stack[stack.length - 1].node.children || [];
      stack[stack.length - 1].node.children.push(newNode);
      stack.push({ node: newNode, indent });
    }
    return root;
  }, []);

  // ── 从 chainTreeData[currentChainId] 同步 markdown ──
  useEffect(() => {
    syncMarkdownFnRef.current(currentTreeData, currentChainId);
  }, [currentTreeData, currentChainId]);

  // ── 将树形数据转换为 graph 固定布局 ──
  const buildGraphData = useCallback((treeData: ChainTreeNode) => {
    const nodes: any[] = [];
    const edges: any[] = [];
    const LEVEL_W = 160;
    const NODE_H = 60;

    interface NodePosInfo {
      nodeId: string;
      depth: number;
      globalIndexAtDepth: number;
    }
    let depthFirstAll: NodePosInfo[] = [];

    if (treeData) {
      function collectAll(node: ChainTreeNode, depth: number) {
        depthFirstAll.push({ nodeId: node.nodeId, depth, globalIndexAtDepth: 0 });
        if (node.children) {
          node.children.forEach(child => collectAll(child, depth + 1));
        }
      }
      collectAll(treeData, 0);

      const depthGroups = new Map<number, NodePosInfo[]>();
      depthFirstAll.forEach(info => {
        if (!depthGroups.has(info.depth)) depthGroups.set(info.depth, []);
        depthGroups.get(info.depth)!.push(info);
      });
      depthGroups.forEach(group => {
        group.forEach((info, idx) => { info.globalIndexAtDepth = idx; });
      });

      const posMap = new Map<string, NodePosInfo>();
      depthFirstAll.forEach(info => posMap.set(info.nodeId, info));
      const maxDepth = depthFirstAll.reduce((m, i) => Math.max(m, i.depth), 0);
      const depthTotal = depthFirstAll.filter(i => i.depth === maxDepth).length;
      const canvasWidth = 60 + (maxDepth + 1) * LEVEL_W + 100;
      const canvasHeight = Math.max(depthTotal * NODE_H + 160, 400);

      function traverse(node: ChainTreeNode) {
        const color = catColor[node.cat] || '#3B82F6';
        const chainInfo = useDataStore.getState().chains.find(c => c.id === currentChainId);
        const isRoot = node.level === 0;
        const isCore = node.cat === '核心';
        const isEquip = node.cat === '装备';
        const isGroupNode = node.name.includes('体系') || node.name.includes('系统');
        const isCollapsed = nodeCollapseMapRef.current[node.nodeId] ?? false;
        const childCount = node.children?.length ?? 0;

        const posInfo = posMap.get(node.nodeId);
        const depth = posInfo?.depth ?? 0;
        const globalIndexAtDepth = posInfo?.globalIndexAtDepth ?? 0;
        const totalAtDepth = depthGroups.get(depth)?.length ?? 1;
        const totalHeight = totalAtDepth * NODE_H;
        const y = -totalHeight / 2 + globalIndexAtDepth * NODE_H + NODE_H / 2;
        const x = 60 + depth * LEVEL_W;

        nodes.push({
          name: node.name,
          nodeId: node.nodeId,
          value: node.value,
          activity: node.activity,
          cat: node.cat,
          depth,
          collapsed: isCollapsed,
          x,
          y,
          draggable: true,
          itemStyle: {
            color: isRoot ? tc.mapArea : tc.mapArea2,
            borderColor: isEquip ? '#FAAD14' : isCore ? '#00E676' : color,
            borderWidth: isCore ? 3 : isEquip ? 2.5 : 1.5,
            shadowBlur: isCore ? 20 : 8,
            shadowColor: (isCore ? '#00E676' : color) + '40',
            borderRadius: 6,
          },
          label: {
            show: true,
            position: 'inside',
            formatter: isRoot
              ? `{title|${chainInfo?.name || '产业链'}}`
              : [
                  `{title|${node.name}}`,
                  `{scale|${node.value}亿}  {dot|●}  {act|景气 ${node.activity}%}${childCount > 0 ? `{toggle|${isCollapsed ? '▶' : '▼'}}` : ''}`,
                ].join('\n'),
            rich: {
              title: {
                fontSize: isRoot ? 14 : isCore ? 13 : (isGroupNode ? 12 : 11),
                fontWeight: 'bold' as const,
                color: isCore ? '#00E676' : isEquip ? '#FAAD14' : tc.textWhite,
                padding: [0, 0, 0, 0],
                align: 'center' as const,
              },
              scale: { fontSize: isGroupNode ? 9 : 10, color: '#67e8f9', align: 'center' as const },
              dot: { fontSize: 6, color: tc.mapBorder, align: 'center' as const },
              act: {
                fontSize: isGroupNode ? 9 : 10,
                color: node.activity >= 85 ? '#00E676' : node.activity >= 70 ? '#FAAD14' : '#FF4D4F',
                align: 'center' as const,
              },
              toggle: { fontSize: 8, color: '#F59E0B', align: 'right' as const },
            },
            verticalAlign: 'middle' as const,
            align: 'center' as const,
          },
          symbol: 'roundRect',
          symbolSize: isRoot ? [130, 48] : isGroupNode ? [110, 44] : [100, 42],
        });

        if (node.children && !isCollapsed) {
          node.children.forEach((child) => {
            edges.push({ source: node.name, target: child.name });
            traverse(child);
          });
        }
      }

      traverse(treeData);
      return { nodes, edges, canvasWidth, canvasHeight };
    }

    return { nodes, edges, canvasWidth: 800, canvasHeight: 400 };
  }, [tc, currentChainId]);

  const chainTrace = useMemo(() => {
    if (!selected || !currentTreeData) return null;
    const tree = currentTreeData;

    function findPath(node: ChainTreeNode, path: ChainTreeNode[]): ChainTreeNode[] | null {
      if (!selected) return null;
      const newPath = [node, ...path];
      if (node.nodeId === selected.id) return newPath;
      if (node.children) {
        for (const child of node.children) {
          const result = findPath(child, newPath);
          if (result) return result;
        }
      }
      return null;
    }

    const roots = tree.children || [];
    let fullPath: ChainTreeNode[] | null = null;
    for (const root of roots) {
      fullPath = findPath(root, []);
      if (fullPath) break;
    }
    if (!fullPath || fullPath.length === 0 || !selected) return null;

    const idx = fullPath.findIndex(n => n.nodeId === selected.id);

    return {
      upstream: fullPath.slice(0, idx).reverse(),
      downstream: fullPath.slice(idx + 1),
    };
  }, [selected, currentTreeData]);

  const getCategoryIndex = (category: string): number => {
    if (currentChainId === 'chain_humanoid') {
      const hrCatMap: Record<string, number> = {
        '上游': 0, '上游原材料': 0,
        '基础材料': 1,
        '核心零部件': 2,
        '关键子系统': 3,
        '整机制造': 4, '核心': 4,
        '终端应用': 5, '下游': 5, '下游应用': 5,
        '研发支撑': 6, '支撑服务': 6,
      };
      return hrCatMap[category] ?? 0;
    }
    const catMap: Record<string, number> = {
      '上游原材料': 0, '上游': 0,
      '中游制造': 1, '核心': 1, '中游': 1,
      '装备供应商': 2, '装备': 2,
      '下游应用': 3, '下游': 3,
    };
    return catMap[category] ?? 0;
  };

  const processTreeNode = useCallback((node: ChainTreeNode, isCollapsed = false): any => {
    const color = catColor[node.cat] || '#3B82F6';
    const chainInfo = useDataStore.getState().chains.find(c => c.id === currentChainId);
    const isRoot = node.level === 0;
    const isCore = node.cat === '核心';
    const isEquip = node.cat === '装备';
    const isGroupNode = node.name.includes('体系') || node.name.includes('系统');
    const hasChildren = (node.children?.length ?? 0) > 0;

    return {
      name: node.name,
      value: node.value,
      activity: node.activity,
      cat: node.cat,
      nodeId: node.nodeId,
      collapsed: isCollapsed,
      itemStyle: {
        color: isRoot ? tc.mapArea : tc.mapArea2,
        borderColor: isEquip ? '#FAAD14' : isCore ? '#00E676' : color,
        borderWidth: isCore ? 3 : isEquip ? 2.5 : 1.5,
        shadowBlur: isCore ? 20 : 8,
        shadowColor: (isCore ? '#00E676' : color) + '40',
        borderRadius: 6,
      },
      label: {
        show: true,
        position: 'inside',
        formatter: isRoot
          ? `{title|${chainInfo?.name || '产业链'}}`
          : [
              `{title|${node.name}}`,
              `{scale|${node.value}亿}  {dot|●}  {act|景气 ${node.activity}%}`,
            ].join('\n'),
        rich: {
          title: {
            fontSize: isRoot ? 14 : isCore ? 13 : (isGroupNode ? 12 : 11),
            fontWeight: 'bold' as const,
            color: isCore ? '#00E676' : isEquip ? '#FAAD14' : tc.textWhite,
            padding: [0, 0, 0, 0],
            align: 'center' as const,
          },
          scale: {
            fontSize: isGroupNode ? 9 : 10,
            color: '#67e8f9',
            align: 'center' as const,
          },
          dot: {
            fontSize: 6,
            color: tc.mapBorder,
            align: 'center' as const,
          },
          act: {
            fontSize: isGroupNode ? 9 : 10,
            color: node.activity >= 85 ? '#00E676' : node.activity >= 70 ? '#FAAD14' : '#FF4D4F',
            align: 'center' as const,
          },
        },
        verticalAlign: 'middle' as const,
        align: 'center' as const,
      },
      ...(hasChildren ? {
        symbol: ['path://', isCollapsed
          ? 'M-6,0 L6,0 M0,-6 L0,6'
          : 'M-5,0 L5,0'
        ].join(''),
        symbolSize: [14, 14],
        symbolOffset: [8, 0],
        symbolRotate: 0,
      } : {}),
      children: (node.children || []).map((c: ChainTreeNode) => processTreeNode(c, false)),
    };
  }, [tc, currentChainId]);

  const toggleRelType = (t: RelationType) => {
    setActiveRelTypes(prev => {
      const s = new Set(prev);
      s.has(t) ? s.delete(t) : s.add(t);
      return s;
    });
  };

  const filteredLinks = useMemo(
    () => relationLinks.filter(l => activeRelTypes.has(l.type)),
    [activeRelTypes],
  );

  const nodeRelations = useMemo(() => {
    if (!selectedNode) return [];
    return filteredLinks.filter(l => l.sourceId === selectedNode.firmId || l.targetId === selectedNode.firmId);
  }, [selectedNode, filteredLinks]);

  // ── Markdown 编辑后同步到思维导图（临时，不持久化）──
  const handleMarkdownChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMarkdownSource(e.target.value);
    markdownSourceRef.current = e.target.value;
  }, []);

  const handleMarkdownSync = useCallback(() => {
    const newTree = parseMarkdownToTree(markdownSourceRef.current);
    if (!newTree) return;
    const { setChainTreeData } = useDataStore.getState();
    setChainTreeData({ ...useDataStore.getState().chainTreeData, [currentChainId]: newTree });
    setNodeCollapseMap({});
    setSelected(null);
  }, [currentChainId, parseMarkdownToTree]);

  const handleMarkdownReset = useCallback(() => {
    setMarkdownSource(markdownSourceRef.current);
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);

    if (viewMode === 'relation') {
      const nodeMap = new Map(enterpriseNodes.map(n => [n.name, n]));
      const firmIdMap = new Map(enterpriseNodes.map(n => [n.firmId, n]));
      const gNodes = enterpriseNodes.map(n => ({
        name: n.short,
        fullName: n.name,
        firmId: n.firmId,
        symbolSize: filteredLinks.filter(l => l.sourceId === n.firmId || l.targetId === n.firmId).length * 7 + 30,
        itemStyle: { color: n.color, borderColor: n.color, borderWidth: 2, shadowBlur: 18, shadowColor: n.color + '50' },
        label: { show: true, color: tc.textWhite, fontSize: 11, fontWeight: 'bold' as const, formatter: '{b}' },
      }));
      const gLinks = filteredLinks.map(l => ({
        source: firmIdMap.get(l.sourceId)?.short || l.sourceId,
        target: firmIdMap.get(l.targetId)?.short || l.targetId,
        fullSource: l.sourceId,
        fullTarget: l.targetId,
        relType: l.type,
        relLabel: l.label,
        relDetail: l.detail,
        lineStyle: {
          color: relationTypeConfig[l.type].color,
          width: l.type === 'chain' ? 2.5 : 1.8,
          curveness: l.type === 'executive' ? 0.3 : l.type === 'association' ? -0.2 : 0.1,
          type: l.type === 'executive' ? 'dashed' as const : l.type === 'association' ? 'dotted' as const : 'solid' as const,
          opacity: 0.75,
        },
      }));
      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          backgroundColor: tc.tooltipBg, borderColor: tc.tooltipBorder,
          textStyle: { color: tc.textWhite, fontSize: 12 },
          formatter: (p: any) => {
            if (p.dataType === 'node') {
              const nd = nodeMap.get(p.data.fullName);
              if (!nd) return p.name;
              return `<div style="font-weight:bold;font-size:13px;margin-bottom:4px">${nd.name}</div>
                <div style="color:${nd.color};margin-bottom:2px">${nd.industry} · ${nd.city}</div>
                <div style="font-size:11px;color:#94a3b8">园区: ${firmIdMap.get(nd.firmId)?.parkId || ''}</div>
                <div style="font-size:11px;color:#94a3b8">高管: ${nd.executive}</div>`;
            }
            if (p.dataType === 'edge') {
              const cfg = relationTypeConfig[p.data.relType as RelationType];
              return `<div style="margin-bottom:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cfg.color};margin-right:6px"></span><b>${cfg.label}</b></div>
                <div style="font-size:12px;margin-bottom:2px">${p.data.relLabel}</div>
                ${p.data.relDetail ? `<div style="font-size:11px;color:#94a3b8">${p.data.relDetail}</div>` : ''}`;
            }
            return '';
          },
        },
        series: [{
          type: 'graph',
          layout: 'force',
          roam: true,
          zoom: 1,
          force: { repulsion: 400, gravity: 0.12, edgeLength: [120, 250], friction: 0.6 },
          data: gNodes,
          links: gLinks,
          edgeSymbol: ['circle', 'arrow'],
          edgeSymbolSize: [4, 10],
          emphasis: {
            focus: 'adjacency' as const,
            lineStyle: { width: 4, opacity: 1 },
            itemStyle: { shadowBlur: 30, borderWidth: 4 },
          },
          edgeLabel: { show: false },
        }],
      } as any);
      chart.on('click', (params: any) => {
        if (params.dataType === 'node') {
          const nd = nodeMap.get(params.data.fullName);
          if (nd) { setSelectedNode(nd); setSelectedLink(null); }
        }
        if (params.dataType === 'edge') {
          const link = filteredLinks.find(l => {
            const sn = firmIdMap.get(l.sourceId)?.short || l.sourceId;
            const tn = firmIdMap.get(l.targetId)?.short || l.targetId;
            return sn === params.data.source && tn === params.data.target && l.type === params.data.relType;
          });
          if (link) { setSelectedLink(link); setSelectedNode(null); }
        }
      });
      const h = () => chart.resize();
      window.addEventListener('resize', h);
      return () => { window.removeEventListener('resize', h); chart.dispose(); };
    }

    if (viewMode === 'graph') {
      const gCats = currentChainId === 'chain_humanoid'
        ? [
            { name: '上游', itemStyle: { color: '#3B82F6' } },
            { name: '基础材料', itemStyle: { color: '#06B6D4' } },
            { name: '核心零部件', itemStyle: { color: '#10B981' } },
            { name: '关键子系统', itemStyle: { color: '#22C55E' } },
            { name: '整机制造', itemStyle: { color: '#84CC16' } },
            { name: '终端应用', itemStyle: { color: '#EAB308' } },
            { name: '研发支撑', itemStyle: { color: '#F97316' } },
          ]
        : [
            { name: '上游原材料', itemStyle: { color: '#3B82F6' } },
            { name: '中游制造', itemStyle: { color: '#00E676' } },
            { name: '装备供应商', itemStyle: { color: '#FAAD14' } },
            { name: '下游应用', itemStyle: { color: '#A78BFA' } },
          ];

      const currentNodes = chainNodes.filter(n => n.chainId === currentChainId);
      const currentRelations = chainNodeRelations.filter(r => r.chainId === currentChainId);

      const dynGraphNodes = currentNodes
        .filter(n => n.graphX !== undefined && n.graphY !== undefined)
        .map(n => ({
          name: n.name,
          x: n.graphX || 0,
          y: n.graphY || 0,
          symbolSize: (n.graphSize || 44) * 0.8,
          category: getCategoryIndex(n.graphCategory || ''),
          value: n.scale,
          nodeId: n.id,
        }));

      const dynGraphLinks = currentRelations.map(r => {
        const sourceNode = currentNodes.find(n => n.id === r.sourceNodeId);
        const targetNode = currentNodes.find(n => n.id === r.targetNodeId);
        return {
          source: sourceNode?.name || r.sourceNodeId,
          target: targetNode?.name || r.targetNodeId,
          sourceNodeId: r.sourceNodeId,
          targetNodeId: r.targetNodeId,
          relationType: r.relationType,
          description: r.description,
        };
      });

      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { backgroundColor: tc.tooltipBg, borderColor: tc.tooltipBorder, textStyle: { color: tc.textWhite, fontSize: 12 },
          formatter: (p: any) => {
            if (p.dataType === 'node') {
              const node = currentNodes.find(n => n.name === p.name);
              if (node) {
                return `<b>${node.name}</b><br/>规模: ${node.scale}亿<br/>活力: ${node.activity}%`;
              }
              return `<b>${p.name}</b>`;
            }
            if (p.dataType === 'edge') {
              return `<b>${p.data.description || '流向关系'}</b>`;
            }
            return '';
          },
        },
        legend: { data: gCats.map(c => c.name), textStyle: { color: tc.labelColor, fontSize: 11 }, top: 12, left: 'center', itemGap: 30 },
        series: [{
          type: 'graph', layout: 'none', roam: true, zoom: 0.65, categories: gCats,
          data: dynGraphNodes.map(n => ({
            ...n,
            label: { show: true, color: tc.textWhite, fontSize: (n.symbolSize || 35) > 50 ? 13 : 11, fontWeight: (n.symbolSize || 35) > 50 ? 'bold' as const : 'normal' as const },
            itemStyle: { color: gCats[n.category]?.itemStyle.color || '#3B82F6', shadowBlur: 15, shadowColor: (gCats[n.category]?.itemStyle.color || '#3B82F6') + '50', borderColor: gCats[n.category]?.itemStyle.color || '#3B82F6', borderWidth: 2 },
          })),
          links: dynGraphLinks.map(l => ({ ...l, lineStyle: { color: tc.mapBorder, width: 1.5, curveness: 0.15, opacity: 0.7 } })),
          edgeSymbol: ['none', 'arrow'], edgeSymbolSize: [0, 10],
          emphasis: { focus: 'adjacency' as const, lineStyle: { width: 4, opacity: 1 } },
        }],
      } as any);
      chart.on('click', (params: any) => {
        if (params.dataType === 'node' && params.name) {
          const node = currentNodes.find(n => n.name === params.name);
          if (node && nodeDetails[node.name]) {
            setSelected(nodeDetails[node.name]);
          }
        }
      });
      const h = () => chart.resize();
      window.addEventListener('resize', h);
      return () => { window.removeEventListener('resize', h); chart.dispose(); };
    }

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: '5%', bottom: '5%', left: '2%', right: '2%' },
      roam: true,
      tooltip: {
        backgroundColor: tc.tooltipBg,
        borderColor: tc.tooltipBorder,
        textStyle: { color: tc.textWhite, fontSize: 12 },
        formatter: (p: any) => {
          if (!p.data.value) return p.data.name;
          const c = catColor[p.data.cat] || '#3B82F6';
          return `<div style="font-weight:bold;font-size:14px;margin-bottom:6px">${p.data.name}</div>
                  <div style="color:${c};margin-bottom:4px">${p.data.cat}</div>
                  <div>行业规模: <b>${p.data.value}亿</b></div>
                  <div>开工景气: <b style="color:${p.data.activity >= 85 ? '#00E676' : '#FAAD14'}">${p.data.activity}%</b></div>`;
        },
      },
      series:
        currentTreeData?.children
          ? (() => {
              const { nodes, edges, canvasWidth, canvasHeight } = buildGraphData(currentTreeData!);
              if (chartRef.current) {
                chartRef.current.style.height = `${canvasHeight}px`;
                chartRef.current.style.width = `${canvasWidth}px`;
              }
              return [{
                type: 'graph' as const,
                layout: 'none' as const,
                data: nodes,
                links: edges,
                left: 60,
                top: 60,
                width: canvasWidth,
                height: canvasHeight,
                roam: true,
                lineStyle: { color: tc.mapBorder, width: 1.2, curveness: 0.3, opacity: 0.8 },
                emphasis: { lineStyle: { color: '#3B82F6', width: 2 }, itemStyle: { borderWidth: 3, shadowBlur: 30 } },
                edgeSymbol: ['none', 'arrow'],
                edgeSymbolSize: [0, 10],
                animationDuration: 600,
                animationEasing: 'cubicOut' as const,
              }];
            })()
          : [{
              type: 'tree' as const,
              layout: 'orthogonal' as const,
              data: [processTreeNode(currentTreeData!)],
              orient: 'LR' as const,
              expandAndCollapse: true,
              roam: true,
              zoom: 0.9,
              symbol: 'roundRect',
              symbolSize: [120, 48],
              initialTreeDepth: -1,
              lineStyle: { color: tc.mapBorder, width: 1.5 },
              emphasis: { lineStyle: { color: '#3B82F6', width: 2.5 }, itemStyle: { borderWidth: 3 } },
              leaves: { label: { verticalAlign: 'middle' as const, align: 'center' as const } },
              animationDuration: 500,
              animationEasing: 'cubicOut' as const,
              collapseWidth: 2,
              collapseTrigger: 'node' as const,
            }],
    } as any);

    if (currentTreeData?.children) {
      chart.on('click', (params: any) => {
        const data = params.data;
        if (!data?.nodeId) return;

        function findNode(node: ChainTreeNode): ChainTreeNode | null {
          if (node.nodeId === data.nodeId) return node;
          if (node.children) {
            for (const child of node.children) {
              const found = findNode(child);
              if (found) return found;
            }
          }
          return null;
        }
        const nodeData = findNode(currentTreeData);
        if (!nodeData || (nodeData.children?.length ?? 0) === 0) return;

        const next = !nodeCollapseMapRef.current[data.nodeId];
        nodeCollapseMapRef.current = { ...nodeCollapseMapRef.current, [data.nodeId]: next };
        setNodeCollapseMap(nodeCollapseMapRef.current);
      });
    }

    treeInstanceRef.current = chart;

    const h = () => chart.resize();
    window.addEventListener('resize', h);
    return () => { window.removeEventListener('resize', h); chart.dispose(); };
  }, [viewMode, tc, filteredLinks, chainNodes, chainNodeRelations, currentTreeData, currentChainId, nodeDetails, processTreeNode, buildGraphData]);

  useEffect(() => {
    if (!barRef.current) return;
    const chart = echarts.init(barRef.current);
    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 8, right: 15, bottom: 24, left: 70 },
      xAxis: { type: 'value', max: 100, axisLabel: { color: tc.labelColor, fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: tc.splitLine, type: 'dashed' } }, axisLine: { show: false } },
      yAxis: { type: 'category', data: sideData.map(d => d.env), axisLabel: { color: tc.labelLight, fontSize: 10 }, axisLine: { lineStyle: { color: tc.axisLine } } },
      tooltip: { backgroundColor: tc.tooltipBg, borderColor: tc.tooltipBorder, textStyle: { color: tc.textWhite } },
      series: [
        { name: '银行信贷', type: 'bar', stack: 't', data: sideData.map(d => d.bank), itemStyle: { color: '#3B82F6' }, barWidth: 14 },
        { name: '金租同业', type: 'bar', stack: 't', data: sideData.map(d => d.lease), itemStyle: { color: '#00E676' }, barWidth: 14 },
      ],
      legend: { data: ['银行信贷', '金租同业'], textStyle: { color: tc.labelColor, fontSize: 10 }, bottom: 0, itemWidth: 10, itemHeight: 8 },
    });
    const h = () => chart.resize();
    window.addEventListener('resize', h);
    return () => { window.removeEventListener('resize', h); chart.dispose(); };
  }, [tc]);

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-dark-border)' }}>
        <div className="flex items-center gap-3">
          <GitBranch className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-bold">产业链结构化沙盘</h2>
          <select
            value={currentChainId}
            onChange={(e) => { setCurrentChainId(e.target.value); setNodeCollapseMap({}); nodeCollapseMapRef.current = {}; }}
            className="ml-2 px-2 py-1 text-xs rounded bg-transparent border border-gray-700 text-gray-300 hover:border-blue-500 transition-colors"
          >
            {chains.map(c => (
              <option key={c.id} value={c.id} style={{ background: '#0f172a' }}>{c.name}</option>
            ))}
          </select>
          <span className="text-xs text-gray-500 ml-2">
            {viewMode === 'tree' ? '树形拓扑' : viewMode === 'graph' ? '力导向图谱' : viewMode === 'relation' ? '联系链路' : 'Markdown 源码'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-dark-border)' }}>
            <button onClick={() => setViewMode('tree')} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${viewMode === 'tree' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
              <TreePine className="w-3.5 h-3.5" /> 树形图
            </button>
            <button onClick={() => setViewMode('graph')} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${viewMode === 'graph' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
              <Network className="w-3.5 h-3.5" /> 图谱
            </button>
            <button onClick={() => { setViewMode('relation'); setSelectedNode(null); setSelectedLink(null); }} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${viewMode === 'relation' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
              <Link2 className="w-3.5 h-3.5" /> 联系链路
            </button>
            <button onClick={() => setViewMode('markdown')} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${viewMode === 'markdown' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
              <Code className="w-3.5 h-3.5" /> Markdown
            </button>
          </div>
          {viewMode === 'relation' ? (
            <div className="flex items-center gap-2 text-xs">
              {(Object.entries(relationTypeConfig) as [RelationType, typeof relationTypeConfig[RelationType]][]).map(([k, cfg]) => {
                const Icon = cfg.icon;
                const active = activeRelTypes.has(k);
                return (
                  <button key={k} onClick={() => toggleRelType(k)} className={`flex items-center gap-1 px-2 py-1 rounded-md transition-all ${active ? 'ring-1' : 'opacity-40 hover:opacity-70'}`} style={active ? { backgroundColor: cfg.color + '20', color: cfg.color, outlineColor: cfg.color } : { color: '#6b7280' }}>
                    <Icon className="w-3 h-3" />{cfg.label}
                    <span className="text-[10px] ml-0.5 font-mono">({relationLinks.filter(l => l.type === k).length})</span>
                  </button>
                );
              })}
            </div>
          ) : viewMode === 'markdown' ? null : (
            <div className="flex items-center gap-4 text-xs text-gray-400">
              {[['上游原材料','bg-blue-500'],['中游制造','bg-green-500'],['装备供应','bg-yellow-500'],['下游应用','bg-purple-400']].map(([l,c])=>(
                <span key={l} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${c}`} />{l}</span>
              ))}
              <button
                onClick={() => setShowOpportunityPanel(v => !v)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md transition-all ${showOpportunityPanel ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700/50 text-gray-500'}`}
                title={showOpportunityPanel ? '隐藏商机发现面板' : '显示商机发现面板'}
              >
                <Zap className="w-3 h-3" />商机
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative" style={{ overflowY: 'auto', overflowX: 'auto' }}>
          {viewMode === 'markdown' ? (
            <div className="flex flex-col h-full p-4 gap-3" style={{ minWidth: '100%', minHeight: '100%' }}>
              <div className="flex items-center justify-between shrink-0">
                <div className="text-xs" style={{ color: 'var(--c-text-muted)' }}>
                  产业链思维导图 Markdown 源码 · 可直接编辑并同步到树形图
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleMarkdownReset}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
                    style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)', color: 'var(--c-text-secondary)' }}
                  >
                    <RefreshCw className="w-3 h-3" /> 重置
                  </button>
                  <button
                    onClick={handleMarkdownSync}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium text-white transition-colors"
                    style={{ backgroundColor: '#3B82F6' }}
                  >
                    <Save className="w-3 h-3" /> 同步到思维导图
                  </button>
                </div>
              </div>
              <textarea
                value={markdownSource}
                onChange={handleMarkdownChange}
                className="flex-1 rounded-lg p-4 text-sm font-mono leading-relaxed resize-none focus:outline-none focus:ring-1"
                style={{
                  backgroundColor: 'var(--c-surface)',
                  border: '1px solid var(--c-border)',
                  color: 'var(--c-text)',
                  minHeight: 400,
                }}
                spellCheck={false}
              />
            </div>
          ) : (
            <>
              <div ref={chartRef} style={{ width: 'max-content', minHeight: '100%' }} />
              {showOpportunityPanel && (
                <div className="absolute top-4 left-4 tech-panel px-4 py-2 flex items-center gap-3 text-xs">
                  <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <div>
                    <span className="text-yellow-300 font-bold">商机发现</span>
                    <span className="text-gray-400 ml-2">企业A(链主) → 企业B(设备) 订单流入 <b className="text-yellow-300">1.5亿</b></span>
                  </div>
                </div>
              )}
              <div className="absolute bottom-4 left-4 flex items-center gap-2 text-[10px] text-gray-600">
                <Eye className="w-3 h-3" /> 单击节点折叠/展开 · 拖拽平移 · 滚轮缩放
              </div>
            </>
          )}
        </div>

        <div className="w-[320px] shrink-0 flex flex-col overflow-y-auto" style={{ borderLeft: '1px solid var(--color-dark-border)' }}>
          {viewMode === 'relation' ? (<>
            {selectedNode && (
              <div className="p-4" style={{ borderBottom: '1px solid var(--color-dark-border)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedNode.color }} />
                  <span className="text-sm font-bold">{selectedNode.short}</span>
                  <span className="text-[10px] text-gray-500 ml-auto">{selectedNode.industry}</span>
                </div>
                <div className="space-y-1.5 text-xs mb-3">
                  <div className="flex items-center gap-2"><MapPinned className="w-3.5 h-3.5 text-cyan-400 shrink-0" /><span style={{ color: 'var(--c-text-secondary)' }}>{selectedNode.city} · {selectedNode.parkId}</span></div>
                  <div className="flex items-center gap-2"><Users2 className="w-3.5 h-3.5 text-orange-400 shrink-0" /><span style={{ color: 'var(--c-text-secondary)' }}>高管: {selectedNode.executive}</span></div>
                  {selectedNode.associations.length > 0 && (
                    <div className="flex items-start gap-2"><Award className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" /><span style={{ color: 'var(--c-text-secondary)' }}>{selectedNode.associations.join('、')}</span></div>
                  )}
                </div>
                <div className="text-[10px] text-gray-500 mb-2">关联链路 ({nodeRelations.length})</div>
                {nodeRelations.map((r, i) => {
                  const cfg = relationTypeConfig[r.type];
                  const peer = r.sourceId === selectedNode.firmId ? r.targetId : r.sourceId;
                  const peerNode = enterpriseNodes.find(n => n.firmId === peer);
                  return (
                    <div key={i} className="flex items-start gap-2 py-2 px-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors" style={{ borderBottom: '1px solid rgba(30,64,112,0.15)' }} onClick={() => { setSelectedLink(r); setSelectedNode(null); }}>
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: cfg.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
                          <span className="text-xs" style={{ color: 'var(--c-text-secondary)' }}>{peerNode?.short || peer}</span>
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">{r.label}</div>
                      </div>
                      <ArrowRight className="w-3 h-3 text-gray-600 shrink-0 mt-1" />
                    </div>
                  );
                })}
              </div>
            )}
            {selectedLink && (
              <div className="p-4" style={{ borderBottom: '1px solid var(--color-dark-border)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Link2 className="w-4 h-4" style={{ color: relationTypeConfig[selectedLink.type].color }} />
                  <span className="text-sm font-bold" style={{ color: relationTypeConfig[selectedLink.type].color }}>{relationTypeConfig[selectedLink.type].label}</span>
                </div>
                <div className="flex items-center gap-2 mb-3 text-xs">
                  <div className="flex-1 text-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(10,26,47,0.5)' }}>
                    <div className="font-bold" style={{ color: enterpriseNodes.find(n => n.firmId === selectedLink.sourceId)?.color }}>{enterpriseNodes.find(n => n.firmId === selectedLink.sourceId)?.short}</div>
                    <div className="text-[9px] text-gray-500">{enterpriseNodes.find(n => n.firmId === selectedLink.sourceId)?.industry}</div>
                  </div>
                  <div className="flex flex-col items-center gap-1 px-2">
                    <div className="w-10 h-px" style={{ backgroundColor: relationTypeConfig[selectedLink.type].color }} />
                    <span className="text-[9px]" style={{ color: relationTypeConfig[selectedLink.type].color }}>{selectedLink.label}</span>
                  </div>
                  <div className="flex-1 text-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(10,26,47,0.5)' }}>
                    <div className="font-bold" style={{ color: enterpriseNodes.find(n => n.firmId === selectedLink.targetId)?.color }}>{enterpriseNodes.find(n => n.firmId === selectedLink.targetId)?.short}</div>
                    <div className="text-[9px] text-gray-500">{enterpriseNodes.find(n => n.firmId === selectedLink.targetId)?.industry}</div>
                  </div>
                </div>
                {selectedLink.detail && (
                  <div className="p-2.5 rounded-lg text-xs" style={{ backgroundColor: 'rgba(10,26,47,0.4)', color: 'var(--c-text-secondary)', borderLeft: `3px solid ${relationTypeConfig[selectedLink.type].color}` }}>
                    {selectedLink.detail}
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <button className="flex-1 text-xs py-1.5 rounded-lg text-white/80 hover:text-white transition-colors" style={{ backgroundColor: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }} onClick={() => { setSelectedNode(enterpriseNodes.find(n => n.firmId === selectedLink.sourceId) || null); setSelectedLink(null); }}>
                    查看 {enterpriseNodes.find(n => n.firmId === selectedLink.sourceId)?.short}
                  </button>
                  <button className="flex-1 text-xs py-1.5 rounded-lg text-white/80 hover:text-white transition-colors" style={{ backgroundColor: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }} onClick={() => { setSelectedNode(enterpriseNodes.find(n => n.firmId === selectedLink.targetId) || null); setSelectedLink(null); }}>
                    查看 {enterpriseNodes.find(n => n.firmId === selectedLink.targetId)?.short}
                  </button>
                </div>
              </div>
            )}
            {!selectedNode && !selectedLink && (
              <div className="p-4" style={{ borderBottom: '1px solid var(--color-dark-border)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Link2 className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-bold">联系链路总览</span>
                </div>
                <div className="text-[11px] text-gray-500 mb-3">点击节点或连线查看详情</div>
                <div className="space-y-2">
                  {(Object.entries(relationTypeConfig) as [RelationType, typeof relationTypeConfig[RelationType]][]).map(([k, cfg]) => {
                    const cnt = relationLinks.filter(l => l.type === k).length;
                    const Icon = cfg.icon;
                    return (
                      <div key={k} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ backgroundColor: activeRelTypes.has(k) ? cfg.color + '10' : 'transparent' }}>
                        <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                        <span className="text-xs flex-1" style={{ color: activeRelTypes.has(k) ? cfg.color : '#6b7280' }}>{cfg.label}</span>
                        <span className="text-xs font-mono" style={{ color: cfg.color }}>{cnt}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="p-4 flex-1">
              <div className="tech-title text-xs mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-yellow-400" /> 关系洞察</div>
              <div className="space-y-2.5">
                {[
                  { title: '企业A ↔ 企业E', desc: '产业链供应 + 高管私交 + 同一协会，关系强度极高', color: '#00E676', score: '95' },
                  { title: '企业A ↔ 企业B', desc: '同园区 + 同城 + 前同事 + 同联盟，深度绑定', color: '#3B82F6', score: '92' },
                  { title: '企业I ↔ 企业E', desc: '战略合作 + 高层互访 + 行业协会，核心伙伴', color: '#A78BFA', score: '88' },
                  { title: '企业A ↔ 企业I', desc: '同行竞合 + 协会共建标准，行业双寡头', color: '#F97316', score: '82' },
                ].map((item, i) => (
                  <div key={i} className="p-2.5 rounded-lg" style={{ backgroundColor: 'rgba(10,26,47,0.4)', borderLeft: `3px solid ${item.color}` }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold" style={{ color: item.color }}>{item.title}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: item.color + '20', color: item.color }}>{item.score}分</span>
                    </div>
                    <div className="text-[10px] text-gray-500">{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </>) : viewMode === 'markdown' ? null : (<>
            {selected && (
              <div className="p-4" style={{ borderBottom: '1px solid var(--color-dark-border)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Crosshair className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-bold">{selected.name}</span>
                  <span className="text-[10px] text-gray-500 ml-auto">行业规模 {selected.scale}亿</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(10,26,47,0.5)' }}>
                    <div className="text-base font-bold font-mono text-green-400">{selected.activity}%</div>
                    <div className="text-[9px] text-gray-600">开工景气</div>
                  </div>
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(10,26,47,0.5)' }}>
                    <div className="text-base font-bold font-mono text-blue-400">{selected.bankRatio}%</div>
                    <div className="text-[9px] text-gray-600">银行占比</div>
                  </div>
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(10,26,47,0.5)' }}>
                    <div className="text-base font-bold font-mono text-cyan-300">{selected.leaseRatio}%</div>
                    <div className="text-[9px] text-gray-600">金租占比</div>
                  </div>
                </div>
                <div className="w-full h-3 rounded-full overflow-hidden flex">
                  <div style={{ width: `${selected.bankRatio}%`, backgroundColor: '#3B82F6' }} />
                  <div style={{ width: `${selected.leaseRatio}%`, backgroundColor: '#00E676' }} />
                </div>
                <div className="flex justify-between text-[9px] mt-1"><span className="text-blue-400">银行 {selected.bankRatio}%</span><span className="text-green-400">金租 {selected.leaseRatio}%</span></div>

                {selected.firms && selected.firms.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] text-gray-500 mb-1">链上企业</div>
                    {selected.firms.map((f, i) => {
                      const firmInfo = enterpriseNodes.find(n => n.firmId === f.firmId);
                      return (
                        <div key={i} className="flex items-center justify-between py-2 text-xs cursor-pointer hover:bg-white/5 rounded px-2 transition-colors" style={{ borderBottom: '1px solid rgba(30,64,112,0.2)' }} onClick={() => navigate('/customer')}>
                          <div>
                            <div style={{ color: 'var(--c-text-secondary)' }}>{firmInfo?.name || f.firmId}</div>
                            <div className="text-[10px] flex items-center gap-2" style={{ color: 'var(--c-text-muted)' }}>
                              <span>{f.role}</span>
                              {f.manager && <span className="flex items-center gap-0.5"><UserCircle2 className="w-3 h-3" />{f.manager}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2"><span className="text-cyan-300 font-mono text-[11px]">{f.asset}</span><ArrowRight className="w-3 h-3" style={{ color: 'var(--c-text-muted)' }} /></div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {chainTrace && (chainTrace.upstream.length > 0 || chainTrace.downstream.length > 0) && (
                  <div className="mt-3">
                    <div className="text-[10px] text-gray-500 mb-1.5">供应链追溯</div>
                    <div className="space-y-1.5">
                      {chainTrace.upstream.length > 0 && (
                        <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
                          <div className="text-[9px] mb-1" style={{ color: '#60A5FA' }}>上游追溯</div>
                          <div className="text-[10px] leading-relaxed" style={{ color: 'var(--c-text-secondary)' }}>
                            {chainTrace.upstream.map((n, i) => (
                              <span key={n.nodeId}>
                                <span className="font-medium" style={{ color: '#93C5FD' }}>{n.name}</span>
                                {i < chainTrace.upstream.length - 1 && <span className="mx-0.5" style={{ color: '#60A5FA' }}>→</span>}
                              </span>
                            ))}
                            <span className="mx-0.5" style={{ color: '#60A5FA' }}>→</span>
                            <span className="font-bold" style={{ color: '#F59E0B' }}>{selected.name}</span>
                          </div>
                        </div>
                      )}
                      {chainTrace.downstream.length > 0 && (
                        <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                          <div className="text-[9px] mb-1" style={{ color: '#34D399' }}>下游应用</div>
                          <div className="text-[10px] leading-relaxed" style={{ color: 'var(--c-text-secondary)' }}>
                            <span className="font-bold" style={{ color: '#F59E0B' }}>{selected.name}</span>
                            {chainTrace.downstream.map((n) => (
                              <span key={n.nodeId}>
                                <span className="mx-0.5" style={{ color: '#34D399' }}>→</span>
                                <span className="font-medium" style={{ color: '#6EE7B7' }}>{n.name}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="p-4 flex-1">
              <div className="tech-title text-xs mb-2 flex items-center gap-2"><DollarSign className="w-4 h-4 text-blue-400" /> 各环节融资结构</div>
              <div ref={barRef} style={{ width: '100%', height: 180 }} />
            </div>

            <div className="p-4" style={{ borderTop: '1px solid var(--color-dark-border)' }}>
              <div className="tech-title text-xs mb-2 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-400" /> 重点关注企业</div>
              {[
                { n: '企业A · 电池制造', s: '链主满产', c: 'text-green-400', a: '10亿', m: '李明' },
                { n: '企业B · 锂电设备', s: '扩产潜客', c: 'text-yellow-400', a: '潜客', m: '李明' },
                { n: '企业I · 电池巨头', s: '行业龙头', c: 'text-green-400', a: '12亿', m: '陈磊' },
                { n: '企业C · 传统机加工', s: '高危预警', c: 'text-red-400', a: '2亿', m: '张强' },
              ].map((e, i) => (
                <div key={i} className="flex items-center justify-between py-2 text-xs cursor-pointer hover:bg-white/5 rounded px-2 transition-colors" style={{ borderBottom: '1px solid rgba(30,64,112,0.2)' }} onClick={() => navigate('/customer')}>
                  <div>
                    <span style={{ color: 'var(--c-text-secondary)' }}>{e.n}</span><span className={`ml-2 text-[10px] ${e.c}`}>{e.s}</span>
                    <div className="text-[9px] flex items-center gap-0.5 mt-0.5" style={{ color: 'var(--c-text-muted)' }}><UserCircle2 className="w-3 h-3" />{e.m}</div>
                  </div>
                  <div className="flex items-center gap-2"><span className="text-gray-400 font-mono text-[11px]">{e.a}</span><ArrowRight className="w-3 h-3 text-gray-600" /></div>
                </div>
              ))}
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
};
