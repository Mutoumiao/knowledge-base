import {
  Activity,
  Cpu,
  FileText,
  Heart,
  LayoutDashboard,
  type LucideIcon,
  Radar,
  Settings as SettingsIcon,
  Shield,
  Ticket,
  Users,
} from 'lucide-react'
import { PERMISSIONS } from './constants/permissions'
import type { FileRoutesByFullPath } from './routeTree.gen'

type RoutePath = keyof FileRoutesByFullPath

export type RouteKey =
  | 'login'
  | 'dashboard'
  | 'users'
  | 'roles'
  | 'roleDetail'
  | 'audit'
  | 'invitations'
  | 'profile'
  | 'changePassword'
  | 'modelProviders'
  | 'moduleSettings'
  | 'companions'
  | 'observabilityRag'
  | 'observabilityCompanion'

export interface RouteMeta {
  key: RouteKey
  title: string
  path: RoutePath
  icon?: LucideIcon | null
  nav: boolean
  requiredPermission?: string
}

export const ROUTES_REGISTER: Record<RouteKey, RouteMeta> = {
  login: {
    key: 'login',
    title: '登录',
    path: '/login' as RoutePath,
    icon: null,
    nav: false,
  },
  dashboard: {
    key: 'dashboard',
    title: '控制台',
    path: '/dashboard' as RoutePath,
    icon: LayoutDashboard,
    nav: true,
    requiredPermission: PERMISSIONS.DASHBOARD_READ,
  },
  users: {
    key: 'users',
    title: '用户管理',
    path: '/users' as RoutePath,
    icon: Users,
    nav: true,
    requiredPermission: PERMISSIONS.USERS_READ,
  },
  roles: {
    key: 'roles',
    title: '权限管理',
    path: '/roles' as RoutePath,
    icon: Shield,
    nav: true,
    requiredPermission: PERMISSIONS.ROLES_READ,
  },
  roleDetail: {
    key: 'roleDetail',
    title: '角色详情',
    path: '/roles/$id' as RoutePath,
    icon: Shield,
    nav: false,
    requiredPermission: PERMISSIONS.ROLES_READ,
  },
  audit: {
    key: 'audit',
    title: '审计日志',
    path: '/audit' as RoutePath,
    icon: FileText,
    nav: true,
    requiredPermission: PERMISSIONS.AUDIT_READ,
  },
  invitations: {
    key: 'invitations',
    title: '邀请码管理',
    path: '/invitations' as RoutePath,
    icon: Ticket,
    nav: true,
    requiredPermission: PERMISSIONS.INVITATIONS_READ,
  },
  profile: {
    key: 'profile',
    title: '个人中心',
    path: '/profile' as RoutePath,
    icon: SettingsIcon,
    nav: false,
  },
  changePassword: {
    key: 'changePassword',
    title: '修改密码',
    path: '/change-password' as RoutePath,
    icon: null,
    nav: false,
  },
  modelProviders: {
    key: 'modelProviders',
    title: '模型提供商',
    path: '/model-providers' as RoutePath,
    icon: Cpu,
    nav: true,
    requiredPermission: PERMISSIONS.SETTINGS_READ,
  },
  moduleSettings: {
    key: 'moduleSettings',
    title: '模块配置',
    path: '/module-settings' as RoutePath,
    icon: SettingsIcon,
    nav: true,
    requiredPermission: PERMISSIONS.SETTINGS_READ,
  },
  companions: {
    key: 'companions',
    title: '内置伴侣',
    path: '/companions' as RoutePath,
    icon: Heart,
    nav: true,
    requiredPermission: PERMISSIONS.COMPANIONS_READ,
  },
  // 与控制台 Hub 卡片并存；需 system:metrics（详页 KPI / 慢列表）
  observabilityRag: {
    key: 'observabilityRag',
    title: 'RAG 观测',
    path: '/observability/rag' as RoutePath,
    icon: Radar,
    nav: true,
    requiredPermission: PERMISSIONS.SYSTEM_METRICS,
  },
  observabilityCompanion: {
    key: 'observabilityCompanion',
    title: 'Companion 观测',
    path: '/observability/companion' as RoutePath,
    icon: Activity,
    nav: true,
    requiredPermission: PERMISSIONS.SYSTEM_METRICS,
  },
}

export function getNavItems(): RouteMeta[] {
  return Object.values(ROUTES_REGISTER).filter((r) => r.nav)
}
